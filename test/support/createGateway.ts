/**
 * createGateway(opts) - boots an in-process gateway with a chosen provider, a
 * loaded policy set, and stub identity (test plan section 0). Returns a client
 * for the /v1 API plus handles to assert on downstream calls.
 *
 * Default-deny is not configurable: booting with { defaultEffect: 'allow' } or
 * any equivalent default-allow option MUST throw (CLAUDE.md engineering rules;
 * Suite A).
 *
 * M1: the client is wired to the real decide pipeline (decide, escalation
 * resolution, receipts). Readback, simulate, reconcile and arbitration land at
 * their gating milestones and throw until then.
 */

import type {
  ActionProposal,
  ArbitrationRequest,
  Decision,
  PolicyBundle,
  SignedReceipt,
} from '../../src/types';
import type { PolicySimChange, PolicySimResult } from '../../src/simulate/policy';
import type { ReconcileFlag } from '../../src/reconcile/drift';
import type { Tracer } from '@opentelemetry/api';
import { createGatewayCore } from '../../src/gateway';
import type { Downstream } from '../../src/mcp/downstream';
import { stubMcpServer, type StubMcpServer } from './stubMcpServer';
import type { McpProxyClient } from '../../src/mcp/proxy';
import type { OpenApiDoc } from './committedSpec';
import { defaultBundleFor } from './bundles';
import { agentId } from '../../fixtures/principals';

export interface CreateGatewayOptions {
  provider: 'cedar' | 'opa';
  /** A loaded policy set; omitted means the default fixture bundle. */
  policy?: PolicyBundle;
  /** Allow extra keys so the default-allow guard can reject them at runtime. */
  [key: string]: unknown;
}

export interface PublishedKey {
  keyId: string;
  alg: 'Ed25519';
  publicKey: string;
  retired?: boolean;
}

export interface AssumedState {
  receiptRef: string;
  assumed: SignedReceipt['assumed'];
}

export interface EffectivePolicy {
  principal: string;
  version: string;
  rules: { id: string; effect: string; summary: string }[];
}

export interface ReconcileReport {
  flags: ReconcileFlag[];
  actionsTaken: never[];
}

export interface EscalationResolution {
  resolution: 'approve' | 'deny';
  resolvedBy: string;
}

/** The /v1 control-plane client surface exercised by the suites. */
export interface GatewayClient {
  decide(proposal: ActionProposal, arbitration?: ArbitrationRequest): Promise<Decision>;
  rawDecide(proposal: ActionProposal): Promise<{ status: number; body: Decision }>;
  decideAndFetchReceipt(
    proposal: ActionProposal,
  ): Promise<{ decision: Decision; receipt: SignedReceipt }>;
  decisions(filter: {
    principal?: string;
    since?: string;
    decision?: string;
  }): Promise<Decision[]>;
  state(decisionId: string): Promise<AssumedState>;
  effectivePolicy(principal: string): Promise<EffectivePolicy>;
  loadPolicy(bundle: PolicyBundle): Promise<{ version: string }>;
  simulateAction(proposal: ActionProposal): Promise<Decision>;
  simulatePolicy(req: PolicySimChange): Promise<PolicySimResult>;
  reconcile(req: { since: string }): Promise<ReconcileReport>;
  conflicts(): Promise<unknown[]>;
  escalations(): Promise<{ escalations: unknown[] }>;
  resolveEscalation(
    decisionId: string,
    resolution: EscalationResolution,
  ): Promise<{ receiptRef: string }>;
  receipt(ref: string): Promise<{ receipt: SignedReceipt }>;
  keys(): Promise<{ keys: PublishedKey[] }>;
  openapi(): Promise<OpenApiDoc>;
  rawStatus(path: string): Promise<number>;
}

/** What createGateway returns: the client, plus downstream-assertion handles. */
export interface GatewayHandle extends GatewayClient {
  client: GatewayClient;
  files: StubMcpServer;
  egress: StubMcpServer;
  proxy: McpProxyClient;
  /** The gateway's published Ed25519 public key (PEM), for offline verify. */
  publicKey: string;
  close(): Promise<void>;
}

/** Detects any option that would weaken default-deny. */
function requestsDefaultAllow(opts: CreateGatewayOptions): boolean {
  const defaultAllowKeys = ['defaultEffect', 'default', 'fallback', 'onNoMatch'];
  for (const key of defaultAllowKeys) {
    if (String(opts[key]).toLowerCase() === 'allow') return true;
  }
  return opts['defaultAllow'] === true;
}

const NOT_WIRED = (iface: string): never => {
  throw new Error(`${iface} not wired until its gating milestone`);
};

function toDownstream(server: StubMcpServer): Downstream {
  return {
    name: server.name,
    handles: (tool: string) => server.tools.includes(tool),
    call: (tool: string, args: Record<string, unknown>) => server.call(tool, args),
  };
}

export function createGateway(opts: CreateGatewayOptions): GatewayHandle {
  if (!opts || (opts.provider !== 'cedar' && opts.provider !== 'opa')) {
    throw new Error("createGateway requires provider 'cedar' | 'opa'");
  }
  if (requestsDefaultAllow(opts)) {
    throw new Error('default-deny is not configurable: default-allow options are rejected');
  }

  const files = stubMcpServer('files');
  const egress = stubMcpServer('egress');
  const bundle = opts.policy ?? defaultBundleFor(opts.provider);

  const core = createGatewayCore({
    provider: opts.provider,
    policy: bundle,
    downstreams: [toDownstream(files), toDownstream(egress)],
    identity: { principal: agentId },
    tracer: opts.tracer as Tracer | undefined,
  });

  const client: GatewayClient = {
    async decide(proposal) {
      return core.decide(proposal);
    },
    async rawDecide() {
      return NOT_WIRED('rawDecide');
    },
    async decideAndFetchReceipt(proposal) {
      return core.decideAndFetchReceipt(proposal);
    },
    async decisions(filter) {
      return core.decisions(filter);
    },
    async state(decisionId) {
      return core.state(decisionId);
    },
    async effectivePolicy(principal) {
      return core.effectivePolicy(principal);
    },
    async loadPolicy(b) {
      return core.loadPolicy(b);
    },
    async simulateAction() {
      return NOT_WIRED('simulate/action');
    },
    async simulatePolicy() {
      return NOT_WIRED('simulate/policy');
    },
    async reconcile() {
      return NOT_WIRED('reconcile');
    },
    async conflicts() {
      return NOT_WIRED('conflicts');
    },
    async escalations() {
      return core.escalations();
    },
    async resolveEscalation(decisionId, resolution) {
      return core.resolveEscalation(decisionId, resolution);
    },
    async receipt(ref) {
      return core.receipt(ref);
    },
    async keys() {
      return core.keys();
    },
    async openapi() {
      return NOT_WIRED('openapi.json');
    },
    async rawStatus() {
      return NOT_WIRED('rawStatus');
    },
  };

  return {
    ...client,
    client,
    files,
    egress,
    proxy: core.proxy,
    publicKey: core.publicKey,
    async close() {
      files.reset();
      egress.reset();
    },
  };
}
