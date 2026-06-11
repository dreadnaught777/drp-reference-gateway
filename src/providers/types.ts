/**
 * The provider contract (build brief section 9). One TypeScript interface,
 * two implementations (Cedar, OPA). Parity over a shared scenario set is the
 * proof the abstraction is real (test Suite B).
 *
 * M0 scaffold: interfaces only.
 */

import type { PolicyBundle, PriorContext, Effect } from '../types';

export interface EngineInput {
  principal: string; // SPIFFE ID or attestation subject
  declaredAction: string;
  tool: string;
  resource: { kind: string; id: string };
  args: Record<string, unknown>;
  priorContext: PriorContext | null; // only if signature verified
}

export interface EngineDecision {
  effect: Effect;
  matchedRuleId: string | null; // null means default-deny fired
  reason: string;
}

/** An opaque, provider-internal handle to a validated, loaded bundle. */
export interface LoadedPolicy {
  bundleVersion: string;
  vocabulary: string;
}

export interface DrpProvider {
  readonly name: 'cedar' | 'opa';
  /** Validate and load a bundle; throw on contradiction/unsatisfiability (R4). */
  load(bundle: PolicyBundle): Promise<LoadedPolicy>;
  /** Pure decision: no side effects, no store access. */
  evaluate(input: EngineInput, policy: LoadedPolicy): Promise<EngineDecision>;
}
