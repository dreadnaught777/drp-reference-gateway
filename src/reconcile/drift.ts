/**
 * Reconciliation - drift kind (DRP-layer function, NOT protocol). Replays
 * stored receipts since a timestamp against the currently intended policy and
 * returns flags { kind: 'drift', status: 'for-review', ... } for any stored
 * decision the current policy would decide differently.
 *
 * Hard rule (Suite F): reconcile NEVER mutates, reverts, or emits any action.
 * actionsTaken is always [] and no revert field exists.
 *
 * M0 scaffold: signature only. Gate: Suite F (M5).
 */

export interface ReconcileFlag {
  kind: 'drift' | 'provenance-laundering';
  status: 'for-review';
  [detail: string]: unknown;
}

export function findDrift(_since: string): ReconcileFlag[] {
  throw new Error('reconcile/drift not implemented until M5');
}
