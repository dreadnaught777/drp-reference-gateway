/**
 * Suite H - Identity and cross-principal scope.
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite H.
 * The describe/it bodies below are the frozen test plan; the preamble binds the
 * harness symbols and imports the helpers the plan references. Immutable after
 * transcription (CLAUDE.md): a failure is fixed in src/, never here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGateway, type GatewayHandle } from './support/createGateway';
import { proposal, artefactAdmission } from './support/proposals';
import { attestation } from '../fixtures/principals';

let client: GatewayHandle;

beforeEach(() => {
  client = createGateway({ provider: 'cedar' });
});

// --- begin verbatim transcription (test plan Suite H) ---

describe('principals', () => {
  it.each([
    'spiffe://demo/agent/email-helper',
    'spiffe://demo/workload/etl',
    'spiffe://demo/human/alice',
  ])('decides for principal %s identified by SPIFFE ID', async (id) => {
    const r = await client.decide(proposal({ principal: id }));
    expect(['allow', 'deny', 'escalate']).toContain(r.decision);
    expect(r.principal).toBe(id);
  });

  it('treats an artefact by its attestation subject', async () => {
    const r = await client.decide(artefactAdmission({ subject: attestation.subject }));
    expect(r.principal).toBe(attestation.subject);
  });

  it('human is admitted as a delegated identity (federated OIDC→SPIFFE)', async () => {
    const r = await client.decide(proposal({ principal: 'spiffe://demo/human/alice', delegatedFrom: 'oidc' }));
    expect(r.identitySource).toBe('delegated');
  });

  it('LIMITATION: device principals are weakly modelled - marked, not equal', async () => {
    const r = await client.decide(proposal({ principal: 'spiffe://demo/device/laptop-7' }));
    expect(r.principalCoverage).toBe('partial'); // documented gradient, not a fifth equal type
  });
});

// --- end verbatim transcription ---
