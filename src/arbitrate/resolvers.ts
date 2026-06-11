/**
 * Arbitration resolvers (DRP-layer function, NOT protocol). Two resolvers
 * within one vocabulary:
 *   - most-restrictive: deny beats escalate beats allow
 *   - priority: explicit order wins regardless of strictness
 *
 * The cross-framework limit (sources of differing vocabularies are rejected)
 * lives in the decide path, where the mixed request arrives (semantics
 * section 6); these resolvers only ever see same-vocabulary sources.
 *
 * This module is layer-side and separable: it knows nothing about the store,
 * receipts, or the protocol surface.
 */

import type { EngineDecision } from '../providers/types';
import type { ArbitrationResult, Effect } from '../types';

export type Resolver = 'most-restrictive' | 'priority';

export interface SourceDecision {
  source: string;
  decision: EngineDecision;
}

export interface ArbitrationOutcome {
  winner: SourceDecision;
  result: ArbitrationResult;
}

const RESTRICTIVENESS: Record<Effect, number> = { deny: 3, escalate: 2, allow: 1 };

export function arbitrate(
  decisions: SourceDecision[],
  resolver: Resolver,
  order?: string[],
): ArbitrationOutcome {
  if (decisions.length === 0) {
    throw new Error('arbitration requires at least one source');
  }

  const disagreed = new Set(decisions.map((d) => d.decision.effect)).size > 1;

  let winner: SourceDecision;
  if (resolver === 'priority') {
    // Earliest in the order list wins; sources absent from the order rank last.
    const rank = (source: string): number => {
      const i = (order ?? []).indexOf(source);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    winner = decisions.reduce((best, d) => (rank(d.source) < rank(best.source) ? d : best));
  } else {
    // Most-restrictive: deny beats escalate beats allow; ties keep the first.
    winner = decisions.reduce((best, d) =>
      RESTRICTIVENESS[d.decision.effect] > RESTRICTIVENESS[best.decision.effect] ? d : best,
    );
  }

  return { winner, result: { winner: winner.source, resolver, disagreed } };
}
