/**
 * The single decide path. Every action proposal, whether it arrives over HTTP
 * /v1/decide or through the MCP proxy, flows through this one pipeline:
 *   assemble engine input -> evaluate via the provider -> produce decision
 *   -> sign and chain a receipt -> persist -> enact (allow) / hold (escalate).
 *
 * Order follows semantics section 2: the decision is rendered and recorded
 * before the action executes. For allow, execution follows; for deny the
 * action MUST NOT execute; for escalate it is held unexecuted until resolved.
 */

import { randomUUID } from 'node:crypto';
import type { ActionProposal, Decision, PrincipalCoverage, ReceiptBody } from '../types';
import type { DrpProvider, EngineInput, LoadedPolicy } from '../providers/types';
import type { DecisionStore } from '../state/store';
import type { ReceiptSigner } from '../state/receipts';
import type { Tracer } from '@opentelemetry/api';
import { routeTool, type Downstream } from '../mcp/downstream';
import { emitDecisionEvent } from '../otel';

export interface DecidePipelineDeps {
  provider: DrpProvider;
  loadedPolicy: () => Promise<LoadedPolicy>;
  policyVersion: () => string;
  store: DecisionStore;
  signer: ReceiptSigner;
  downstreams: Downstream[];
  now: () => string;
  tracer?: Tracer;
}

export interface EnactedDecision {
  decision: Decision;
  downstreamResult?: unknown;
}

function principalCoverage(principal: string): PrincipalCoverage {
  // Devices are deliberately partial: marked, not modelled as a fifth equal
  // type (build brief section 4; Suites H, L).
  return principal.includes('/device/') ? 'partial' : 'full';
}

/** Mint a prefixed, sortable-enough identifier. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

/** Forward an allowed (or approved) action to the downstream that handles it. */
export async function enact(
  downstreams: Downstream[],
  proposal: ActionProposal,
): Promise<unknown> {
  const downstream = routeTool(downstreams, proposal.tool);
  if (!downstream) {
    throw new Error(`no downstream server handles tool ${proposal.tool}`);
  }
  return downstream.call(proposal.tool, proposal.args);
}

/**
 * Run a proposal through the pipeline. With { simulated: true } the effect is
 * suppressed (no downstream call, nothing queued) and the receipt is marked
 * simulated - the identical evaluation path, per semantics section 6.
 */
export async function decide(
  deps: DecidePipelineDeps,
  proposal: ActionProposal,
  opts: { simulated?: boolean } = {},
): Promise<EnactedDecision> {
  const simulated = opts.simulated ?? false;
  const policy = await deps.loadedPolicy();
  const policyVersion = deps.policyVersion();

  const input: EngineInput = {
    principal: proposal.principal,
    declaredAction: proposal.declaredAction,
    tool: proposal.tool,
    resource: proposal.resource,
    args: proposal.args,
    priorContext: null, // trusted context carriage arrives at M6
  };

  const eng = await deps.provider.evaluate(input, policy);

  const decisionId = newId('d');
  const receiptId = newId('r');
  const ts = deps.now();

  const decision: Decision = {
    decision: eng.effect,
    decisionId,
    reason: eng.reason,
    receiptRef: receiptId,
    provider: deps.provider.name,
    principal: proposal.principal,
    identitySource: proposal.identitySource ?? 'native',
    principalCoverage: principalCoverage(proposal.principal),
    policyVersion,
    contextToken: '', // carriage half (Interface 3) arrives at M6
    traceparent: proposal.context?.traceparent ?? null,
    sawPriorContext: false,
    contextTrusted: null,
    gatedOn: 'declared-action',
    limitations: [],
    arbitration: null,
  };

  const body: ReceiptBody = {
    v: 1,
    receiptId,
    decisionId,
    ts,
    principal: proposal.principal,
    action: {
      tool: proposal.tool,
      declaredAction: proposal.declaredAction,
      resource: proposal.resource.id,
    },
    decision: eng.effect,
    reason: eng.reason,
    provider: deps.provider.name,
    policyVersion,
    assumed: { policyVersion, principal: proposal.principal, priorContext: null },
    simulated,
    prevHash: deps.store.lastReceiptHash(),
  };

  deps.store.putReceipt(deps.signer.sign(body));
  deps.store.putDecision(decision);

  // Every decision emits the drp.decision OTel event (semantics: the record of
  // what was decided). Suite C asserts it reaches the configured exporter.
  emitDecisionEvent(deps.tracer, decision);

  let downstreamResult: unknown;
  if (!simulated) {
    if (eng.effect === 'allow') {
      downstreamResult = await enact(deps.downstreams, proposal);
    } else if (eng.effect === 'escalate') {
      deps.store.enqueueEscalation({
        decisionId,
        proposal,
        createdAt: ts,
        status: 'pending',
      });
    }
  }

  return { decision, downstreamResult };
}
