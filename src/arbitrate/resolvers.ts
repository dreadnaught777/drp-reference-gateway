/**
 * Arbitration resolvers (DRP-layer function, NOT protocol). Two resolvers
 * within one vocabulary:
 *   - most-restrictive: deny beats escalate beats allow
 *   - priority: explicit order wins regardless of strictness
 * Every disagreement is recorded and queryable at GET /v1/conflicts.
 *
 * Limit (Section 5 / Suite G): sources from different framework vocabularies
 * are rejected with an error matching /cross-framework arbitration not
 * supported/i.
 *
 * M0 scaffold: signatures only. Gate: Suite G (M5).
 */

import type { EngineDecision } from '../providers/types';
import type { ArbitrationResult } from '../types';

export type Resolver = 'most-restrictive' | 'priority';

export interface SourceDecision {
  source: string;
  decision: EngineDecision;
}

export function arbitrate(
  _decisions: SourceDecision[],
  _resolver: Resolver,
  _order?: string[],
): { winner: SourceDecision; result: ArbitrationResult } {
  throw new Error('arbitration resolvers not implemented until M5');
}
