/**
 * Suite L - Acceptance group: "must NOT fake" (release-blocking).
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite L.
 * The describe/it bodies below are the frozen test plan; the preamble binds the
 * harness symbols. Immutable after transcription (CLAUDE.md). These tests pass
 * by implementing the LIMIT, never the capability: a limitation test that starts
 * passing for the wrong reason is a defect.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGateway, type GatewayHandle } from './support/createGateway';
import {
  proposal,
  artefactReadProposal,
  proposalAnomalousVsOtherPrincipal,
  declaredBenignProposal,
} from './support/proposals';
import { deceptiveTool, readReportedMetrics } from './support/honesty';
import { agentId } from '../fixtures/principals';
import { t2 } from './support/scenarios';

let client: GatewayHandle;

beforeEach(() => {
  client = createGateway({ provider: 'cedar' });
});

// --- begin verbatim transcription (test plan Suite L) ---

describe('honesty acceptance criteria', () => {
  it('cross-framework arbitration is rejected, not silently approximated', async () => {
    await expect(client.decide(proposal(), { sources: ['cedar-policy', 'foreign-framework-X'] }))
      .rejects.toThrow(/cross-framework arbitration not supported/i);
  });

  it('async provenance laundering is allowed inline (limit is real and tested)', async () => {
    const read = await client.decide(artefactReadProposal({ principal: agentId, at: t2 }));
    expect(read.decision).toBe('allow');
  });

  it('cross-principal-baseline anomaly is not caught inline', async () => {
    // an action only anomalous relative to ANOTHER principal's baseline
    const r = await client.decide(proposalAnomalousVsOtherPrincipal());
    expect(r.decision).not.toBe('deny'); // a per-principal decision cannot see it
    expect(r.limitations).toContain('cross-principal-baseline');
  });

  it('the model is untrusted: a downstream tool diverging from its schema is not caught by the gateway', async () => {
    // gateway gated on the DECLARED action; the tool does something else internally
    const r = await client.decide(declaredBenignProposal());
    expect(r.decision).toBe('allow');
    deceptiveTool.doSomethingElse();
    expect(r.gatedOn).toBe('declared-action'); // documented model-side dependency
  });

  it('any reported latency is backed by a reproducible benchmark in the repo', async () => {
    const claims = readReportedMetrics();
    for (const c of claims) expect(c.benchmarkScript).toBeDefined();
  });

  it('device principals are not claimed as a fifth equal type', async () => {
    const r = await client.decide(proposal({ principal: 'spiffe://demo/device/laptop-7' }));
    expect(r.principalCoverage).toBe('partial');
  });
});

// --- end verbatim transcription ---
