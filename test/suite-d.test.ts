/**
 * Suite D - Readback (the observe side; Interface 2).
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite D.
 * The describe/it bodies below are the frozen test plan; the preamble binds the
 * harness symbols and imports the helpers the plan references. Immutable after
 * transcription (CLAUDE.md): a failure is fixed in src/, never here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGateway, type GatewayHandle } from './support/createGateway';
import { readFileProposal } from './support/proposals';
import { stricterPolicy } from './support/bundles';
import { agentId } from '../fixtures/principals';

let client: GatewayHandle;

beforeEach(() => {
  client = createGateway({ provider: 'cedar' });
});

// --- begin verbatim transcription (test plan Suite D) ---

describe('readback', () => {
  it('a decision made via /decide is queryable in /decisions', async () => {
    const r = await client.decide(readFileProposal());
    const list = await client.decisions({ principal: agentId });
    expect(list.map(d => d.decisionId)).toContain(r.decisionId);
  });

  it('/state/{id} returns the receipt plus the state the decision assumed', async () => {
    const r = await client.decide(readFileProposal());
    const s = await client.state(r.decisionId);
    expect(s.receiptRef).toBe(r.receiptRef);
    expect(s.assumed).toMatchObject({ policyVersion: expect.any(String), principal: agentId });
  });

  it('/state/{id} pins the policy version EVALUATED, not the version current at query time', async () => {
    const r = await client.decide(readFileProposal());
    const versionAtDecision = r.policyVersion;
    await client.loadPolicy(stricterPolicy);              // active version moves on
    const s = await client.state(r.decisionId);
    expect(s.assumed.policyVersion).toBe(versionAtDecision); // readback answers history, not now
  });

  it('/policy/effective reflects the loaded policy for a principal', async () => {
    const eff = await client.effectivePolicy(agentId);
    expect(eff.rules.length).toBeGreaterThan(0);
    expect(eff.principal).toBe(agentId);
  });

  it('effective policy changes when policy is reloaded', async () => {
    const before = await client.effectivePolicy(agentId);
    await client.loadPolicy(stricterPolicy);
    const after = await client.effectivePolicy(agentId);
    expect(after.version).not.toBe(before.version);
  });
});

// --- end verbatim transcription ---
