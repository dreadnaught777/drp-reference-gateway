/**
 * Plan mode (b), policy simulation: evaluate a candidate bundle in shadow
 * against previously recorded proposals and report which decisions flip, from
 * what to what, and how many are unchanged.
 *
 * The response carries trafficSource: "recorded" - the documented limit that
 * this replays history, not a live production shadow (semantics section 6;
 * build brief R4). v0.1 defines this over recorded traffic only.
 */

import type { DrpProvider, LoadedPolicy } from '../providers/types';
import type { ActionProposal, Effect, PolicyBundle } from '../types';
import { engineInputFrom } from '../pipeline/decide';

/** A past proposal with its original decision (recordedTraffic.jsonl line). */
export interface RecordedEntry {
  proposal: ActionProposal;
  decision: Effect;
  decisionId: string;
  ts: string;
}

export interface FlippedDecision {
  decisionId: string;
  from: Effect;
  to: Effect;
}

export interface PolicySimResult {
  flipped: FlippedDecision[];
  unchanged: number;
  trafficSource: 'recorded';
}

/** Request shape used by the harness client (change = candidate bundle). */
export interface PolicySimChange {
  change: PolicyBundle;
  traffic: string;
}

/**
 * Replay recorded traffic against an already-loaded candidate policy. Pure: no
 * side effects, no receipts, no downstream calls - it only compares decisions.
 */
export async function simulatePolicyDiff(
  provider: DrpProvider,
  loaded: LoadedPolicy,
  recorded: RecordedEntry[],
): Promise<PolicySimResult> {
  const flipped: FlippedDecision[] = [];
  let unchanged = 0;

  for (const entry of recorded) {
    const { effect } = await provider.evaluate(engineInputFrom(entry.proposal), loaded);
    if (effect === entry.decision) {
      unchanged += 1;
    } else {
      flipped.push({ decisionId: entry.decisionId, from: entry.decision, to: effect });
    }
  }

  return { flipped, unchanged, trafficSource: 'recorded' };
}
