/**
 * Reconciliation - drift kind (DRP-layer function, NOT protocol). Replays
 * stored decisions against the currently intended policy and flags any whose
 * stored effect the current policy would now decide differently.
 *
 * Hard rule (Suite F): reconcile NEVER mutates, reverts, or emits any action.
 * This module returns flags only - there is no revert path anywhere in it.
 *
 * This encodes the series' position that security readback feeds
 * flag-for-review, not auto-revert.
 */

import type { DrpProvider, LoadedPolicy } from '../providers/types';
import type { HistoryEntry } from '../state/store';
import { engineInputFrom } from '../pipeline/decide';

export interface ReconcileFlag {
  kind: 'drift' | 'provenance-laundering';
  status: 'for-review';
  [detail: string]: unknown;
}

/**
 * Compare each stored decision to what the current policy would decide for the
 * same proposal. A difference is drift, flagged for-review.
 */
export async function findDrift(
  provider: DrpProvider,
  loaded: LoadedPolicy,
  history: HistoryEntry[],
): Promise<ReconcileFlag[]> {
  const flags: ReconcileFlag[] = [];
  for (const entry of history) {
    const { effect } = await provider.evaluate(engineInputFrom(entry.proposal), loaded);
    if (effect !== entry.decision) {
      flags.push({
        kind: 'drift',
        status: 'for-review',
        decisionId: entry.decisionId,
        principal: entry.proposal.principal,
        resource: entry.proposal.resource.id,
        was: entry.decision,
        now: effect,
      });
    }
  }
  return flags;
}
