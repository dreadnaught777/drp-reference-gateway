/**
 * Plan mode (a), action simulation: run the full decide pipeline with
 * execution suppressed - same decision, no downstream call, receipt marked
 * simulated: true. A simulated escalate queues nothing for resolution.
 *
 * M0 scaffold: signature only. Gate: Suite E (M4).
 */

import type { ActionProposal, Decision } from '../types';

export async function simulateAction(_proposal: ActionProposal): Promise<Decision> {
  throw new Error('simulate/action not implemented until M4');
}
