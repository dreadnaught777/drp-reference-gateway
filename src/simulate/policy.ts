/**
 * Plan mode (b), policy simulation: load a candidate policy in shadow, replay
 * recordedTraffic.jsonl (past proposals with their original decisions), and
 * return the diff: which recorded decisions flip, from what to what, and how
 * many are unchanged. The response carries trafficSource: "recorded" - the
 * documented limit that this replays history, not a live production shadow.
 *
 * M0 scaffold: signature only. Gate: Suite E (M4).
 */

import type { PolicyBundle } from '../types';

export interface PolicySimChange {
  change: PolicyBundle;
  traffic: string;
}

export interface FlippedDecision {
  decisionId: string;
  from: string;
  to: string;
}

export interface PolicySimResult {
  flipped: FlippedDecision[];
  unchanged: number;
  trafficSource: 'recorded';
}

export async function simulatePolicy(_req: PolicySimChange): Promise<PolicySimResult> {
  throw new Error('simulate/policy not implemented until M4');
}
