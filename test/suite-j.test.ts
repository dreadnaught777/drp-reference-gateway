/**
 * Suite J - Versioned protocol, spec-first (Interface 5).
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite J.
 * The describe/it bodies below are the frozen test plan; the preamble binds the
 * harness symbols. Immutable after transcription (CLAUDE.md): a failure is fixed
 * in src/, never here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGateway, type GatewayHandle } from './support/createGateway';
import { committedSpec } from './support/committedSpec';

let client: GatewayHandle;

beforeEach(() => {
  client = createGateway({ provider: 'cedar' });
});

// --- begin verbatim transcription (test plan Suite J) ---

describe('protocol', () => {
  it('serves the committed protocol document, byte-identical in content', async () => {
    const served = await client.openapi();
    const committed = committedSpec();
    expect(served).toEqual(committed); // served contract IS the committed contract
  });

  it('the served document carries the committed spec version', async () => {
    const served = await client.openapi();
    expect(served.info.version).toBe(committedSpec().info.version); // 0.1.x today; no hardcoding
  });

  it('the contract covers the protocol surface', async () => {
    const spec = await client.openapi();
    expect(spec.paths).toHaveProperty('/decide');
    expect(spec.paths).toHaveProperty('/policy/effective');
    expect(spec.paths).toHaveProperty('/state/{decisionId}');
  });

  it('serves under a versioned path so the contract can evolve', async () => {
    expect(await client.rawStatus('/v1/decisions')).not.toBe(404);
  });
});

// --- end verbatim transcription ---
