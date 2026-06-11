/**
 * Suite K - Demo scenarios (end-to-end; the essay's enforceable/unsolved split).
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite K.
 * The describe/it bodies below are the frozen test plan; the preamble binds the
 * harness symbols and imports the helpers the plan references. Immutable after
 * transcription (CLAUDE.md): a failure is fixed in src/, never here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGateway, type GatewayHandle } from './support/createGateway';
import {
  egressProposal,
  readCrmProposal,
  sendExternalProposal,
  artefactWriteProposal,
  artefactReadProposal,
} from './support/proposals';
import { ALLOWLISTED, PROTECTED_DATA, t0, t1, t2 } from './support/scenarios';
import { agentId, workloadId } from '../fixtures/principals';

let client: GatewayHandle;
let egress: GatewayHandle['egress'];

beforeEach(() => {
  const gw = createGateway({ provider: 'cedar' });
  client = gw;
  egress = gw.egress;
});

// --- begin verbatim transcription (test plan Suite K) ---

describe('scenario 1: trusted-channel exploit (enforceable inline)', () => {
  it('denies a permitted destination used for an impermissible purpose', async () => {
    // egress domain is allow-listed, but the call exfiltrates protected data via that path
    const r = await client.decide(egressProposal({ domain: ALLOWLISTED, payload: PROTECTED_DATA }));
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/capability grant|not a destination filter/i);
    expect(egress.received).toHaveLength(0);
  });
});

describe('scenario 2: cross-principal chain on a synchronous path (enforceable inline)', () => {
  it('catches read-CRM-then-send-external as a composite, though neither call is anomalous alone', async () => {
    const a = await client.decide(readCrmProposal());
    expect(a.decision).toBe('allow'); // innocuous alone
    const b = await client.decide(sendExternalProposal({ priorContext: a.contextToken }));
    expect(b.decision).toBe('deny');  // composite caught via propagated context
    expect(egress.received).toHaveLength(0);
  });
});

describe('scenario 3: async provenance laundering (NOT enforceable inline)', () => {
  it('ALLOWS both halves inline, because no single decision sees both', async () => {
    const write = await client.decide(artefactWriteProposal({ principal: workloadId, at: t1 }));
    const read  = await client.decide(artefactReadProposal({ principal: agentId, at: t2 })); // later, different principal
    expect(write.decision).toBe('allow');
    expect(read.decision).toBe('allow'); // the documented limit: inline prevention is out of reach
  });

  it('flags the laundering pattern only after the fact, in reconciliation', async () => {
    await client.decide(artefactWriteProposal({ principal: workloadId, at: t1 }));
    await client.decide(artefactReadProposal({ principal: agentId, at: t2 }));
    const report = await client.reconcile({ since: t0 });
    expect(report.flags).toContainEqual(expect.objectContaining({ kind: 'provenance-laundering', status: 'for-review' }));
  });
});

// --- end verbatim transcription ---
