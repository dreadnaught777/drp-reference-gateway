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

import type {
  ActionProposal,
  Decision,
  PolicyBundle,
  SignedReceipt,
} from './types';
import type { DrpProvider, LoadedPolicy } from './providers/types';
import { CedarProvider } from './providers/cedar';
import { OpaProvider } from './providers/opa';
import { createStore, type DecisionStore, type HeldEscalation } from './state/store';
import { ReceiptSigner, type PublishedKey } from './state/receipts';
import { decide as runDecide, enact, newId, type EnactedDecision } from './pipeline/decide';
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
}

export interface EscalationResolution {
  resolution: 'approve' | 'deny';
  resolvedBy: string;
}

export interface Gateway {
  decide(proposal: ActionProposal): Promise<Decision>;
  decideAndEnact(proposal: ActionProposal): Promise<EnactedDecision>;
  resolveEscalation(
    decisionId: string,
    resolution: EscalationResolution,
  ): Promise<{ receiptRef: string }>;
  receipt(receiptRef: string): { receipt: SignedReceipt };
  escalations(): { escalations: HeldEscalation[] };
  keys(): { keys: PublishedKey[] };
  proxy: McpProxyClient;
  store: DecisionStore;
}

function makeProvider(name: 'cedar' | 'opa'): DrpProvider {
  return name === 'cedar' ? new CedarProvider() : new OpaProvider();
}

export function createGatewayCore(config: GatewayConfig): Gateway {
  const provider = makeProvider(config.provider);
  const store = createStore();
  const signer = new ReceiptSigner();
  const downstreams = config.downstreams;
  const now = config.now ?? (() => new Date().toISOString());
  const identity = config.identity ?? { principal: 'spiffe://demo/agent/email-helper' };

  // Load once; the decide path awaits the loaded policy (cedar load is sync
  // work wrapped in a promise, so the gateway constructs synchronously).
  let loaded: Promise<LoadedPolicy> | undefined;
  const loadedPolicy = (): Promise<LoadedPolicy> => {
    if (!loaded) loaded = provider.load(config.policy);
    return loaded;
  };

  const deps = {
    provider,
    loadedPolicy,
    policyVersion: () => config.policy.bundleVersion,
    store,
    signer,
    downstreams,
    now,
  };

  const decideAndEnact = (proposal: ActionProposal) => runDecide(deps, proposal);

  const proxy = createMcpProxy({ identity, decideAndEnact });

  return {
    async decide(proposal) {
      const { decision } = await decideAndEnact(proposal);
      return decision;
    },
    decideAndEnact,
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
        policyVersion: config.policy.bundleVersion,
        assumed: {
          policyVersion: config.policy.bundleVersion,
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
    proxy,
    store,
  };
}
