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
import type {
  ActionProposal,
  ArbitrationRequest,
  Decision,
  PriorContext,
  PrincipalCoverage,
  ReceiptBody,
} from '../types';
import type { DrpProvider, EngineDecision, EngineInput, LoadedPolicy } from '../providers/types';
import type { ConflictRecord, DecisionStore } from '../state/store';
import type { ReceiptSigner } from '../state/receipts';
import type { Tracer } from '@opentelemetry/api';
import { routeTool, type Downstream } from '../mcp/downstream';
import { emitDecisionEvent } from '../otel';
import { arbitrate, type SourceDecision } from '../arbitrate/resolvers';
import { signContextToken, verifyContextToken } from '../context/token';

/**
 * The decide path consults named sources only through this context, which the
 * gateway builds from its source registry. Resolver logic stays in the
 * arbitrate/ layer module; the cross-framework rejection stays here, in the
 * protocol path where the mixed request arrives.
 */
export interface ArbitrationContext {
  vocabularyOf(source: string): string;
  evaluate(source: string, input: EngineInput): Promise<EngineDecision>;
  recordConflict(record: ConflictRecord): void;
}

export interface DecidePipelineDeps {
  provider: DrpProvider;
  loadedPolicy: () => Promise<LoadedPolicy>;
  policyVersion: () => string;
  store: DecisionStore;
  signer: ReceiptSigner;
  downstreams: Downstream[];
  now: () => string;
  tracer?: Tracer;
  arbitration?: ArbitrationContext;
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

/** Limitations the runtime declares it cannot enforce inline for this proposal. */
function computeLimitations(proposal: ActionProposal): string[] {
  const limitations: string[] = [];
  // An action anomalous only against another principal's baseline cannot be
  // caught by a per-principal decision (Suite L honesty criterion).
  if (proposal.baselineAnomalyOf) limitations.push('cross-principal-baseline');
  return limitations;
}

/** Mint a prefixed, sortable-enough identifier. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

/** A fresh W3C traceparent, used when a proposal carries none, so chained
 * decisions can be correlated (Suite I; build brief, Interface 3). */
function generateTraceparent(): string {
  const traceId = randomUUID().replace(/-/g, '');
  const spanId = randomUUID().replace(/-/g, '').slice(0, 16);
  return `00-${traceId}-${spanId}-01`;
}

/** Assemble the engine input from a proposal. Shared by the decide path and
 * policy simulation so both evaluate proposals identically. */
export function engineInputFrom(proposal: ActionProposal): EngineInput {
  return {
    principal: proposal.principal,
    declaredAction: proposal.declaredAction,
    tool: proposal.tool,
    resource: proposal.resource,
    args: proposal.args,
    priorContext: null, // trusted context carriage arrives at M6
  };
}

/** Forward an allowed (or approved) action to the downstream that handles it.
 * If no downstream handles the tool there is nothing to forward, so this is a
 * no-op returning undefined rather than an error - the allow decision stands. */
export async function enact(
  downstreams: Downstream[],
  proposal: ActionProposal,
): Promise<unknown> {
  const downstream = routeTool(downstreams, proposal.tool);
  if (!downstream) return undefined;
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
  opts: { simulated?: boolean; arbitration?: ArbitrationRequest } = {},
): Promise<EnactedDecision> {
  const simulated = opts.simulated ?? false;
  const policyVersion = deps.policyVersion();

  const decisionId = newId('d');
  const receiptId = newId('r');
  const ts = deps.now();

  // Verify any carried prior context BEFORE evaluation. A valid token is
  // admitted to policy input; an invalid or tampered one is EXCLUDED (dropped
  // from input) and reported as contextTrusted: false - it does not by itself
  // deny (semantics section 5).
  const incoming = proposal.context?.priorContext;
  let priorContext: PriorContext | null = null;
  let sawPriorContext = false;
  let contextTrusted: boolean | null = null;
  if (incoming) {
    const verified = verifyContextToken(deps.signer, incoming);
    if (verified) {
      priorContext = verified;
      sawPriorContext = true;
      contextTrusted = true;
    } else {
      contextTrusted = false;
    }
  }

  const input: EngineInput = { ...engineInputFrom(proposal), priorContext };

  // Produce the engine decision - by single-source evaluation, or, when the
  // request names sources, by arbitrating across them (layer-side resolver).
  const { eng, arbitration } = await renderEngineDecision(deps, input, opts.arbitration, {
    decisionId,
    ts,
  });

  const traceparent = proposal.context?.traceparent ?? generateTraceparent();

  // Mint this decision's carriage token so a downstream hop can carry it.
  const contextToken = signContextToken(deps.signer, {
    decisionId,
    principal: proposal.principal,
    action: proposal.declaredAction,
    decision: eng.effect,
    policyVersion,
    iat: Math.floor(Date.parse(ts) / 1000),
  });

  const decision: Decision = {
    decision: eng.effect,
    decisionId,
    reason: eng.reason,
    receiptRef: receiptId,
    ts,
    provider: deps.provider.name,
    principal: proposal.principal,
    // A delegated identity (OIDC -> SPIFFE) reports identitySource "delegated".
    identitySource: proposal.delegatedFrom ? 'delegated' : (proposal.identitySource ?? 'native'),
    principalCoverage: principalCoverage(proposal.principal),
    policyVersion,
    contextToken,
    traceparent,
    sawPriorContext,
    contextTrusted,
    gatedOn: 'declared-action',
    limitations: computeLimitations(proposal),
    arbitration,
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
    assumed: { policyVersion, principal: proposal.principal, priorContext },
    simulated,
    prevHash: deps.store.lastReceiptHash(),
  };

  deps.store.putReceipt(deps.signer.sign(body));
  deps.store.putDecision(decision);
  // Keep the proposal alongside the decision so reconciliation can replay it
  // against current policy (simulated decisions are part of the record too).
  deps.store.recordHistory({ decisionId, proposal, decision: eng.effect, ts });

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

/**
 * Render the engine decision. Without sources, a single provider evaluation.
 * With sources, evaluate each and arbitrate - rejecting a mixed-vocabulary
 * request first (the cross-framework limit, semantics section 6), then applying
 * the layer-side resolver and recording any disagreement as a conflict.
 */
async function renderEngineDecision(
  deps: DecidePipelineDeps,
  input: EngineInput,
  request: ArbitrationRequest | undefined,
  meta: { decisionId: string; ts: string },
): Promise<{ eng: EngineDecision; arbitration: Decision['arbitration'] }> {
  const sources = request?.sources ?? [];
  if (sources.length === 0) {
    const eng = await deps.provider.evaluate(input, await deps.loadedPolicy());
    return { eng, arbitration: null };
  }

  if (!deps.arbitration) {
    throw new Error('arbitration requested but no policy sources are configured');
  }
  const ctx = deps.arbitration;

  // A request mixing vocabularies is rejected, not approximated. This rejection
  // sits in the protocol path because the runtime is where the mixed request
  // arrives; same-vocabulary arbitration is the layer's job below.
  const vocabularies = sources.map((s) => ctx.vocabularyOf(s));
  if (new Set(vocabularies).size > 1) {
    throw new Error('cross-framework arbitration not supported');
  }

  const sourceDecisions: SourceDecision[] = await Promise.all(
    sources.map(async (source) => ({ source, decision: await ctx.evaluate(source, input) })),
  );

  const outcome = arbitrate(sourceDecisions, request?.resolver ?? 'most-restrictive', request?.order);

  if (outcome.result.disagreed) {
    ctx.recordConflict({
      decisionId: meta.decisionId,
      ts: meta.ts,
      sources: sourceDecisions.map((s) => ({ source: s.source, effect: s.decision.effect })),
      winner: outcome.result.winner,
      resolver: outcome.result.resolver,
      disagreed: outcome.result.disagreed,
    });
  }

  return { eng: outcome.winner.decision, arbitration: outcome.result };
}
