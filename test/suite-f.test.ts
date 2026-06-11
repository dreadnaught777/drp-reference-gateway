/**
 * Suite F - Reconciliation (R5, flag-for-review only; DRP-layer).
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite F.
 * The describe/it bodies below are the frozen test plan; the preamble binds the
 * harness symbols (client, t0). Immutable after transcription (CLAUDE.md): a
 * failure is fixed in src/, never here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGateway, type GatewayHandle } from './support/createGateway';
import { t0 } from './support/scenarios';

let client: GatewayHandle;

beforeEach(() => {
  client = createGateway({ provider: 'cedar' });
});

// --- begin verbatim transcription (test plan Suite F) ---

describe('reconcile', () => {
  it('flags divergence between intended policy and observed decisions', async () => {
    const report = await client.reconcile({ since: t0 });
    expect(report.flags.length).toBeGreaterThan(0);
    expect(report.flags[0]).toMatchObject({ kind: 'drift', status: 'for-review' });
  });

  it('NEVER auto-reverts: no mutating or rollback action is emitted', async () => {
    const report = await client.reconcile({ since: t0 });
    expect(report.actionsTaken).toEqual([]); // observation only
    expect(report).not.toHaveProperty('reverted');
  });
});

// --- end verbatim transcription ---
