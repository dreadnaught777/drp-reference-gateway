/**
 * Suite B - Provider model (R2, the showcase).
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite B.
 * The describe/it bodies below are the frozen test plan; the preamble imports
 * the harness symbols the plan references. Immutable after transcription
 * (CLAUDE.md): a parity failure is fixed in the adapter or the fixture, never
 * in this test.
 */

import { describe, it, expect } from 'vitest';
import { createGateway } from './support/createGateway';
import { sharedScenarioSet, expectedDecision } from './support/scenarios';
import { proposal, readFileProposal } from './support/proposals';

// --- begin verbatim transcription (test plan Suite B) ---

describe.each(['cedar', 'opa'])('provider parity: %s', (engine) => {
  const client = createGateway({ provider: engine });

  it('produces the same decision as the other engine for the shared scenario set', async () => {
    for (const p of sharedScenarioSet) {
      expect((await client.decide(p)).decision).toBe(expectedDecision(p));
    }
  });

  it('default-denies identically', async () => {
    expect((await client.decide(proposal({ tool: 'unknown' }))).decision).toBe('deny');
  });
});

it('a decision carries which provider produced it (for observability)', async () => {
  const r = await createGateway({ provider: 'cedar' }).decide(readFileProposal());
  expect(r.provider).toBe('cedar');
});

// --- end verbatim transcription ---
