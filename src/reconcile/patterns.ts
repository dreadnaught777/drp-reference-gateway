/**
 * Reconciliation - pattern kind (DRP-layer function, NOT protocol). The
 * provenance-laundering pattern: an artefact write by one principal followed
 * by a read of the same artefact by a different principal across the window,
 * detectable only in the receipt history. Flagged for-review, never reverted.
 *
 * Honesty rule (Section 5 / Suite L): async provenance laundering decides
 * allow inline; it is flagged only here in reconcile, after the fact.
 *
 * M0 scaffold: signature only. Gate: Suite F (M5).
 */

import type { ReconcileFlag } from './drift';

export function findProvenanceLaundering(_since: string): ReconcileFlag[] {
  throw new Error('reconcile/patterns not implemented until M5');
}
