/**
 * Core DRP domain types: the wire shapes carried through the single decide
 * path and out as signed receipts. These mirror the data formats in
 * docs/drp-reference-gateway-build-brief.md section 8.
 *
 * M0 scaffold: types only. Behaviour arrives at the gating milestones.
 */

export type Effect = 'allow' | 'deny' | 'escalate';

export type IdentitySource = 'native' | 'delegated';

export type PrincipalCoverage = 'full' | 'partial';

/** A proposed action arriving over HTTP /v1/decide or via the MCP proxy. */
export interface ActionProposal {
  principal: string;
  identitySource?: IdentitySource;
  delegatedFrom?: string;
  tool: string;
  args: Record<string, unknown>;
  resource: { kind: string; id: string };
  declaredAction: string;
  context?: {
    traceparent?: string;
    /** base64url signed prior-decision token, or absent. */
    priorContext?: string;
  };
}

/** The verified, decoded prior-context token exposed to policy input. */
export interface PriorContext {
  decisionId: string;
  principal: string;
  action: string;
  decision: Effect;
  policyVersion: string;
  iat: number;
}

/** Optional arbitration parameters on a decide request. */
export interface ArbitrationRequest {
  sources?: string[];
  resolver?: 'most-restrictive' | 'priority';
  order?: string[];
}

export interface ArbitrationResult {
  winner: string;
  resolver: 'most-restrictive' | 'priority';
  disagreed: boolean;
}

/** The decision returned from the decide pipeline. */
export interface Decision {
  decision: Effect;
  decisionId: string;
  reason: string;
  receiptRef: string;
  provider: 'cedar' | 'opa';
  principal: string;
  identitySource: IdentitySource;
  principalCoverage: PrincipalCoverage;
  policyVersion: string;
  contextToken: string;
  traceparent: string | null;
  sawPriorContext: boolean;
  contextTrusted: boolean | null;
  gatedOn: 'declared-action';
  limitations: string[];
  arbitration: ArbitrationResult | null;
}

/** The canonicalised, signed unit stored and chained. */
export interface ReceiptBody {
  v: 1;
  receiptId: string;
  decisionId: string;
  ts: string;
  principal: string;
  action: { tool: string; declaredAction: string; resource: string };
  decision: Effect;
  reason: string;
  provider: 'cedar' | 'opa';
  policyVersion: string;
  assumed: {
    policyVersion: string;
    principal: string;
    priorContext: PriorContext | null;
  };
  simulated: boolean;
  /** SHA-256 of the prior receipt body, or literal "genesis" for the first. */
  prevHash: string;
}

/**
 * A stored receipt: the signed body with the detached signature carried
 * alongside (the signature is not inside the signed body).
 */
export interface SignedReceipt extends ReceiptBody {
  sig: string;
  keyId: string;
}

/** A policy bundle as loaded by a provider. */
export interface PolicyBundle {
  bundleVersion: string;
  vocabulary: string;
  engine: 'cedar' | 'opa';
  /** Raw Cedar policy source (engine: 'cedar'). */
  source?: string;
  /** Compiled Rego/WASM module bytes (engine: 'opa'). */
  wasm?: Uint8Array;
  rules?: ManifestRule[];
}

export interface ManifestRule {
  id: string;
  principals: string[];
  effect: Effect;
  summary: string;
}

export interface PolicyManifest {
  bundleVersion: string;
  vocabulary: string;
  engine: 'cedar' | 'opa';
  rules: ManifestRule[];
}
