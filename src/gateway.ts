/**
 * In-process gateway assembly: the decide pipeline, a provider, the MCP proxy,
 * the store, the receipt signer, and the escalation queue wired into one
 * object exposing the control-plane handlers. HTTP /v1 (Fastify, src/server.ts)
 * and the test harness both drive this same core, so the decide path stays
 * singular (build brief sections 2 and 21).
 *
 * Default-deny is not configurable: this core exposes no option to flip the
 * default to allow (CLAUDE.md engineering rules; semantics section 2).
 */

import type { Tracer } from '@opentelemetry/api';
import type {
  ActionProposal,
  Decision,
  Effect,
  PolicyBundle,
  SignedReceipt,
} from './types';
import type { DrpProvider, LoadedPolicy } from './providers/types';
import { CedarProvider } from './providers/cedar';
import { OpaProvider } from './providers/opa';
import { createStore, type DecisionStore, type HeldEscalation } from './state/store';
import { ReceiptSigner, type PublishedKey } from './state/receipts';
import { decide as runDecide, enact, newId, type EnactedDecision } from './pipeline/decide';
import { simulateAction as runSimulateAction } from './simulate/action';
import {
  simulatePolicyDiff,
  type PolicySimResult,
  type RecordedEntry,
} from './simulate/policy';
import { createMcpProxy, type McpProxyClient } from './mcp/proxy';
import type { Downstream } from './mcp/downstream';

export interface GatewayConfig {
  provider: 'cedar' | 'opa';
  policy: PolicyBundle;
  downstreams: Downstream[];
  /** Identity attributed to proxied tool calls. */
  identity?: { principal: string; identitySource?: 'native' | 'delegated' };
  /** Injectable clock for deterministic receipts in tests. */
  now?: () => string;
  /** OpenTelemetry tracer; decisions emit the drp.decision event through it. */
  tracer?: Tracer;
  /** Past proposals + decisions that policy simulation (mode b) replays. */
  recordedTraffic?: RecordedEntry[];
}

export interface EscalationResolution {
  resolution: 'approve' | 'deny';
  resolvedBy: string;
}

export interface AssumedState {
  decisionId: string;
  receiptRef: string;
  assumed: SignedReceipt['assumed'];
}

export interface EffectiveRule {
  id: string;
  effect: Effect;
  summary: string;
}

export interface EffectivePolicy {
  principal: string;
  version: string;
  vocabulary: string;
  rules: EffectiveRule[];
}

export interface Gateway {
  decide(proposal: ActionProposal): Promise<Decision>;
  decideAndEnact(proposal: ActionProposal): Promise<EnactedDecision>;
  decideAndFetchReceipt(
    proposal: ActionProposal,
  ): Promise<{ decision: Decision; receipt: SignedReceipt }>;
  simulateAction(proposal: ActionProposal): Promise<Decision>;
  simulatePolicy(candidate: PolicyBundle): Promise<PolicySimResult>;
  resolveEscalation(
    decisionId: string,
    resolution: EscalationResolution,
  ): Promise<{ receiptRef: string }>;
  receipt(receiptRef: string): { receipt: SignedReceipt };
  escalations(): { escalations: HeldEscalation[] };
  keys(): { keys: PublishedKey[] };
  decisions(filter: { principal?: string; since?: string; decision?: string }): Decision[];
  state(decisionId: string): AssumedState;
  effectivePolicy(principal: string): EffectivePolicy;
  loadPolicy(bundle: PolicyBundle): Promise<{ version: string }>;
  readonly publicKey: string;
  proxy: McpProxyClient;
  store: DecisionStore;
}

function makeProvider(name: 'cedar' | 'opa'): DrpProvider {
  return name === 'cedar' ? new CedarProvider() : new OpaProvider();
}

/** Match a SPIFFE principal against a manifest principal pattern ("*" globs). */
function principalMatches(pattern: string, principal: string): boolean {
  if (pattern === '*') return true;
  const rx = new RegExp(
    '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '.*' : `\\${c}`)) + '$',
  );
  return rx.test(principal);
}

export function createGatewayCore(config: GatewayConfig): Gateway {
  const provider = makeProvider(config.provider);
  const store = createStore();
  const signer = new ReceiptSigner();
  const downstreams = config.downstreams;
  const now = config.now ?? (() => new Date().toISOString());
  const identity = config.identity ?? { principal: 'spiffe://demo/agent/email-helper' };
  const recordedTraffic = config.recordedTraffic ?? [];

  // The active bundle is mutable: /policy load replaces it and the effective
  // version moves on. Readback still answers history, because each receipt
  // pins the version it was evaluated under (semantics section 3).
  let activeBundle = config.policy;
  let loaded: Promise<LoadedPolicy> | undefined;
  const loadedPolicy = (): Promise<LoadedPolicy> => {
    if (!loaded) loaded = provider.load(activeBundle);
    return loaded;
  };

  const deps = {
    provider,
    loadedPolicy,
    policyVersion: () => activeBundle.bundleVersion,
    store,
    signer,
    downstreams,
    now,
    tracer: config.tracer,
  };

  const decideAndEnact = (proposal: ActionProposal) => runDecide(deps, proposal);
  const proxy = createMcpProxy({ identity, decideAndEnact });

  return {
    async decide(proposal) {
      const { decision } = await decideAndEnact(proposal);
      return decision;
    },
    decideAndEnact,
    async decideAndFetchReceipt(proposal) {
      const { decision } = await decideAndEnact(proposal);
      const receipt = store.getReceipt(decision.receiptRef);
      if (!receipt) throw new Error(`no receipt ${decision.receiptRef}`);
      return { decision, receipt };
    },
    async simulateAction(proposal) {
      // Same pipeline, effect suppressed: receipt marked simulated and chained,
      // no downstream call, nothing queued (semantics section 6).
      const { decision } = await runSimulateAction(deps, proposal);
      return decision;
    },
    async simulatePolicy(candidate) {
      // Load the candidate in shadow (this also validates it) and replay the
      // recorded traffic against it. No side effects, no receipts.
      const shadowProvider = makeProvider(candidate.engine);
      const shadowLoaded = await shadowProvider.load(candidate);
      return simulatePolicyDiff(shadowProvider, shadowLoaded, recordedTraffic);
    },
    async resolveEscalation(decisionId, { resolution, resolvedBy }) {
      const held = store.getEscalation(decisionId);
      if (!held || held.status !== 'pending') {
        throw new Error(`no pending escalation for decision ${decisionId}`);
      }

      // The resolution is its own decision: a receipt attributing the resolving
      // principal, chained like any other (semantics section 3: resolve
      // produces a receipt).
      const receiptId = newId('r');
      const ts = now();
      const approved = resolution === 'approve';
      const body = {
        v: 1 as const,
        receiptId,
        decisionId,
        ts,
        principal: resolvedBy,
        action: {
          tool: held.proposal.tool,
          declaredAction: held.proposal.declaredAction,
          resource: held.proposal.resource.id,
        },
        decision: (approved ? 'allow' : 'deny') as 'allow' | 'deny',
        reason: `escalation ${resolution} by ${resolvedBy}`,
        provider: provider.name,
        policyVersion: activeBundle.bundleVersion,
        assumed: {
          policyVersion: activeBundle.bundleVersion,
          principal: resolvedBy,
          priorContext: null,
        },
        simulated: false,
        prevHash: store.lastReceiptHash(),
      };
      store.putReceipt(signer.sign(body));

      held.status = approved ? 'approved' : 'denied';
      if (approved) {
        await enact(downstreams, held.proposal);
      }
      return { receiptRef: receiptId };
    },
    receipt(receiptRef) {
      const receipt = store.getReceipt(receiptRef);
      if (!receipt) throw new Error(`no receipt ${receiptRef}`);
      return { receipt };
    },
    escalations() {
      return { escalations: store.listEscalations() };
    },
    keys() {
      return { keys: [signer.published()] };
    },
    decisions(filter) {
      // Newest first, per the spec's /decisions ordering.
      return store.listDecisions(filter).reverse();
    },
    state(decisionId) {
      const decision = store.getDecision(decisionId);
      if (!decision) throw new Error(`no decision ${decisionId}`);
      const receipt = store.getReceipt(decision.receiptRef);
      if (!receipt) throw new Error(`no receipt for decision ${decisionId}`);
      return { decisionId, receiptRef: decision.receiptRef, assumed: receipt.assumed };
    },
    effectivePolicy(principal) {
      // Served from the bundle manifest, not engine introspection: this keeps
      // readback engine-agnostic (build brief, Interface 2 note).
      const rules = (activeBundle.rules ?? [])
        .filter((r) => (r.principals ?? ['*']).some((p) => principalMatches(p, principal)))
        .map((r) => ({ id: r.id, effect: r.effect, summary: r.summary }));
      return {
        principal,
        version: activeBundle.bundleVersion,
        vocabulary: activeBundle.vocabulary,
        rules,
      };
    },
    async loadPolicy(bundle) {
      // Validate by loading first; a bad bundle must not replace the active one
      // (Suite E). Only swap once the new bundle has loaded successfully.
      const next = provider.load(bundle);
      await next;
      activeBundle = bundle;
      loaded = next;
      return { version: bundle.bundleVersion };
    },
    get publicKey() {
      return signer.publicKeyPem;
    },
    proxy,
    store,
  };
}
