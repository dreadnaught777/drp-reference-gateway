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
  ArbitrationRequest,
  Decision,
  Effect,
  PolicyBundle,
  SignedReceipt,
} from './types';
import type { DrpProvider, EngineInput, LoadedPolicy } from './providers/types';
import { CedarProvider } from './providers/cedar';
import { OpaProvider } from './providers/opa';
import {
  createStore,
  type ConflictRecord,
  type DecisionStore,
  type HeldEscalation,
} from './state/store';
import { ReceiptSigner, type PublishedKey } from './state/receipts';
import {
  decide as runDecide,
  enact,
  newId,
  type ArbitrationContext,
  type EnactedDecision,
} from './pipeline/decide';
import { simulateAction as runSimulateAction } from './simulate/action';
import {
  simulatePolicyDiff,
  type PolicySimResult,
  type RecordedEntry,
} from './simulate/policy';
import { findDrift, type ReconcileFlag } from './reconcile/drift';
import { findProvenanceLaundering } from './reconcile/patterns';
import { createMcpProxy, type McpProxyClient } from './mcp/proxy';
import type { Downstream } from './mcp/downstream';
import { committedContract } from './contract';

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
  /** Past proposals + decisions that policy simulation (mode b) replays, and
   * that seed reconciliation's decision history. */
  recordedTraffic?: RecordedEntry[];
  /** Named policy sources for arbitration (build brief R6). Each carries its
   * own vocabulary; mixing vocabularies in one decide request is rejected. */
  sources?: Record<string, PolicyBundle>;
}

export interface ReconcileReport {
  flags: ReconcileFlag[];
  actionsTaken: never[];
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
  decide(proposal: ActionProposal, arbitration?: ArbitrationRequest): Promise<Decision>;
  decideAndEnact(
    proposal: ActionProposal,
    arbitration?: ArbitrationRequest,
  ): Promise<EnactedDecision>;
  decideAndFetchReceipt(
    proposal: ActionProposal,
  ): Promise<{ decision: Decision; receipt: SignedReceipt }>;
  simulateAction(proposal: ActionProposal): Promise<Decision>;
  simulatePolicy(candidate: PolicyBundle): Promise<PolicySimResult>;
  reconcile(req: { since: string }): Promise<ReconcileReport>;
  conflicts(): ConflictRecord[];
  /** The committed protocol document, served verbatim (Interface 5; Suite J). */
  openapi(): Record<string, unknown>;
  /** HTTP-style status for a /v1 path: 200 if the route exists, else 404. */
  rawStatus(path: string): number;
  /** Decide returning an HTTP envelope: deny is HTTP 200, not a transport error. */
  rawDecide(proposal: ActionProposal): Promise<{ status: number; body: Decision }>;
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

// Known /v1 routes (the protocol surface plus the DRP-layer functions). Exact
// routes and the three parameterised prefixes. Used by rawStatus.
const EXACT_ROUTES = new Set([
  '/v1/decide',
  '/v1/policy',
  '/v1/policy/effective',
  '/v1/decisions',
  '/v1/simulate/action',
  '/v1/simulate/policy',
  '/v1/reconcile',
  '/v1/conflicts',
  '/v1/escalations',
  '/v1/keys',
  '/v1/openapi.json',
  '/v1/healthz',
]);
const PREFIX_ROUTES = ['/v1/state/', '/v1/receipts/', '/v1/escalations/'];

function routeExists(path: string): boolean {
  const clean = path.split('?')[0];
  if (EXACT_ROUTES.has(clean)) return true;
  return PREFIX_ROUTES.some((p) => clean.startsWith(p) && clean.length > p.length);
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
  const sourceRegistry = config.sources ?? {};

  // Seed reconciliation's decision history from recorded traffic (the fixture
  // seeds tests; in deployment the live store is the history).
  for (const entry of config.recordedTraffic ?? []) {
    store.recordHistory({
      decisionId: entry.decisionId,
      proposal: entry.proposal,
      decision: entry.decision,
      ts: entry.ts,
    });
  }

  // The active bundle is mutable: /policy load replaces it and the effective
  // version moves on. Readback still answers history, because each receipt
  // pins the version it was evaluated under (semantics section 3).
  let activeBundle = config.policy;
  let loaded: Promise<LoadedPolicy> | undefined;
  const loadedPolicy = (): Promise<LoadedPolicy> => {
    if (!loaded) loaded = provider.load(activeBundle);
    return loaded;
  };

  // Named policy sources for arbitration, loaded lazily and cached.
  const loadedSources = new Map<string, Promise<{ provider: DrpProvider; loaded: LoadedPolicy }>>();
  const loadSource = (name: string): Promise<{ provider: DrpProvider; loaded: LoadedPolicy }> => {
    if (!loadedSources.has(name)) {
      const bundle = sourceRegistry[name];
      if (!bundle) throw new Error(`unknown policy source ${name}`);
      const p = makeProvider(bundle.engine);
      loadedSources.set(name, p.load(bundle).then((l) => ({ provider: p, loaded: l })));
    }
    return loadedSources.get(name)!;
  };

  const arbitrationContext: ArbitrationContext | undefined =
    Object.keys(sourceRegistry).length > 0
      ? {
          vocabularyOf(name) {
            const bundle = sourceRegistry[name];
            if (!bundle) throw new Error(`unknown policy source ${name}`);
            return bundle.vocabulary;
          },
          async evaluate(name, input: EngineInput) {
            const src = await loadSource(name);
            return src.provider.evaluate(input, src.loaded);
          },
          recordConflict(record) {
            store.recordConflict(record);
          },
        }
      : undefined;

  const deps = {
    provider,
    loadedPolicy,
    policyVersion: () => activeBundle.bundleVersion,
    store,
    signer,
    downstreams,
    now,
    tracer: config.tracer,
    arbitration: arbitrationContext,
  };

  const decideAndEnact = (proposal: ActionProposal, arbitration?: ArbitrationRequest) =>
    runDecide(deps, proposal, { arbitration });
  const proxy = createMcpProxy({ identity, decideAndEnact });

  return {
    async decide(proposal, arbitration) {
      const { decision } = await decideAndEnact(proposal, arbitration);
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
      // recorded decision history against it. No side effects, no receipts.
      const shadowProvider = makeProvider(candidate.engine);
      const shadowLoaded = await shadowProvider.load(candidate);
      const recorded = store.listHistory().map((h) => ({
        proposal: h.proposal,
        decision: h.decision,
        decisionId: h.decisionId,
        ts: h.ts,
      }));
      return simulatePolicyDiff(shadowProvider, shadowLoaded, recorded);
    },
    async reconcile({ since }) {
      // Replay stored decisions against current policy. Observation only:
      // actionsTaken is always empty and there is no revert path (Suite F).
      const policy = await loadedPolicy();
      const history = store.listHistory().filter((h) => h.ts >= since);
      const driftFlags = await findDrift(provider, policy, history);
      const patternFlags = findProvenanceLaundering(history);
      return { flags: [...driftFlags, ...patternFlags], actionsTaken: [] };
    },
    conflicts() {
      return store.listConflicts();
    },
    openapi() {
      return committedContract();
    },
    rawStatus(path) {
      return routeExists(path) ? 200 : 404;
    },
    async rawDecide(proposal) {
      // Deny is not a transport error: all three effects return HTTP 200
      // (semantics section 2).
      const { decision } = await decideAndEnact(proposal);
      return { status: 200, body: decision };
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
