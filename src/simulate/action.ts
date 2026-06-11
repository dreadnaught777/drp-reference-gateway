/**
 * Plan mode (a), action simulation: run the full decide pipeline with
 * execution suppressed - same decision, no downstream call, receipt marked
 * simulated: true, and a simulated escalate queues nothing for resolution.
 *
 * This MUST traverse the identical evaluation path as /decide (semantics
 * section 6): it is the same pipeline function with the simulated flag set, so
 * a divergence between simulated and real decisions is structurally impossible.
 */

import { decide, type DecidePipelineDeps, type EnactedDecision } from '../pipeline/decide';
import type { ActionProposal } from '../types';

export function simulateAction(
  deps: DecidePipelineDeps,
  proposal: ActionProposal,
): Promise<EnactedDecision> {
  return decide(deps, proposal, { simulated: true });
}
