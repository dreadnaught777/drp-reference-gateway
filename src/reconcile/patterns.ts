/**
 * Reconciliation - pattern kind (DRP-layer function, NOT protocol). The
 * provenance-laundering pattern: an artefact written by one principal then read
 * by a DIFFERENT principal later in the window, detectable only in the decision
 * history, never by any single inline decision.
 *
 * Honesty rule (Section 5 / Suite L): async provenance laundering decides allow
 * inline; it is flagged only here, after the fact, for-review. There is no
 * revert path in this module.
 */

import type { HistoryEntry } from '../state/store';
import type { ReconcileFlag } from './drift';

export function findProvenanceLaundering(history: HistoryEntry[]): ReconcileFlag[] {
  const flags: ReconcileFlag[] = [];
  const writes = history.filter((h) => h.proposal.declaredAction === 'write');

  for (const write of writes) {
    const artefact = write.proposal.resource.id;
    const reads = history.filter(
      (h) =>
        h.proposal.declaredAction === 'read' &&
        h.proposal.resource.id === artefact &&
        h.proposal.principal !== write.proposal.principal &&
        h.ts >= write.ts,
    );
    for (const read of reads) {
      flags.push({
        kind: 'provenance-laundering',
        status: 'for-review',
        artefact,
        writer: write.proposal.principal,
        reader: read.proposal.principal,
        writeAt: write.ts,
        readAt: read.ts,
        writeDecision: write.decisionId,
        readDecision: read.decisionId,
      });
    }
  }
  return flags;
}
