/**
 * Suite G - Arbitration (R6, stub-and-flag; DRP-layer).
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite G.
 * The describe/it bodies below are the frozen test plan; the preamble binds the
 * harness symbols. Immutable after transcription (CLAUDE.md): a failure is fixed
 * in src/, never here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGateway, type GatewayHandle } from './support/createGateway';
import { proposal } from './support/proposals';

let client: GatewayHandle;

beforeEach(() => {
  client = createGateway({ provider: 'cedar' });
});

// --- begin verbatim transcription (test plan Suite G) ---

describe('arbitration: within-vocabulary resolvers', () => {
  it('most-restrictive-wins: deny beats allow when two sources disagree', async () => {
    const r = await client.decide(proposal(), { sources: ['lenient', 'strict'], resolver: 'most-restrictive' });
    expect(r.decision).toBe('deny');
    expect(r.arbitration.winner).toBe('strict');
  });

  it('priority-ordered: the higher-priority source wins regardless of strictness', async () => {
    const r = await client.decide(proposal(), { sources: ['lenient', 'strict'], resolver: 'priority', order: ['lenient'] });
    expect(r.arbitration.winner).toBe('lenient');
  });

  it('records conflicts for observability', async () => {
    await client.decide(proposal(), { sources: ['lenient', 'strict'], resolver: 'most-restrictive' });
    const conflicts = await client.conflicts();
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('LIMITATION: resolves within one vocabulary, not across frameworks', async () => {
    // Two sources expressed in the SAME schema resolve.
    // Two sources from DIFFERENT framework vocabularies are rejected as unsupported,
    // because cross-framework arbitration semantics are not delivered here.
    await expect(
      client.decide(proposal(), { sources: ['cedar-policy', 'foreign-framework-X'] })
    ).rejects.toThrow(/cross-framework arbitration not supported/i);
  });
});

// --- end verbatim transcription ---
