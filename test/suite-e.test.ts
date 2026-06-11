/**
 * Suite E - Plan-before-apply (R4; Interface 4).
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite E.
 * The describe/it bodies below are the frozen test plan; the preamble binds the
 * harness symbols and imports the helpers the plan references. Immutable after
 * transcription (CLAUDE.md): a failure is fixed in src/, never here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGateway, type GatewayHandle } from './support/createGateway';
import { readFileProposal, writeFileProposal, p1 } from './support/proposals';
import { hash } from './support/receiptHelpers';
import { tightenEgress, contradictoryCedar } from './support/bundles';
import { agentId } from '../fixtures/principals';

let client: GatewayHandle;
let files: GatewayHandle['files'];

beforeEach(() => {
  const gw = createGateway({ provider: 'cedar' });
  client = gw;
  files = gw.files;
});

// --- begin verbatim transcription (test plan Suite E) ---

describe('simulate', () => {
  it('mode (a): returns the decision without executing the effect', async () => {
    const r = await client.simulateAction(writeFileProposal('sandbox/out.txt'));
    expect(r.decision).toBe('escalate');
    expect(files.received).toHaveLength(0); // critical: no side effect
  });

  it('mode (a): produces a receipt marked simulated, and it participates in the chain', async () => {
    const r = await client.simulateAction(writeFileProposal('sandbox/out.txt'));
    const { receipt } = await client.receipt(r.receiptRef);
    expect(receipt.simulated).toBe(true);
    const next = await client.decideAndFetchReceipt(p1());
    expect(next.receipt.prevHash).toBe(hash(receipt)); // simulated receipts are chain links too
  });

  it('mode (a): a simulated escalate queues nothing for resolution', async () => {
    await client.simulateAction(writeFileProposal('sandbox/out.txt'));
    const { escalations } = await client.escalations();
    expect(escalations).toHaveLength(0);
  });

  it('simulate and decide agree for the same input and policy version (conformance)', async () => {
    const sim = await client.simulateAction(readFileProposal('sandbox/notes.txt'));
    const real = await client.decide(readFileProposal('sandbox/notes.txt'));
    expect(sim.decision).toBe(real.decision); // divergence here is a conformance failure
  });

  it('mode (b): a proposed policy change reports which recorded calls flip', async () => {
    const diff = await client.simulatePolicy({ change: tightenEgress, traffic: 'recordedTraffic.jsonl' });
    expect(diff.flipped).toContainEqual(expect.objectContaining({ from: 'allow', to: 'deny' }));
    expect(diff.unchanged).toBeGreaterThan(0);
  });

  it('Cedar analysis rejects a self-contradictory policy before it can enforce', async () => {
    await expect(client.loadPolicy(contradictoryCedar)).rejects.toThrow(/unsatisfiable|contradict/i);
  });

  it('a rejected bundle does not replace the active bundle', async () => {
    const before = await client.effectivePolicy(agentId);
    await expect(client.loadPolicy(contradictoryCedar)).rejects.toThrow();
    const after = await client.effectivePolicy(agentId);
    expect(after.version).toBe(before.version); // active policy untouched by a failed load
  });

  it('LIMITATION: mode (b) runs against recorded traffic, not a live production shadow', async () => {
    const diff = await client.simulatePolicy({ change: tightenEgress, traffic: 'recordedTraffic.jsonl' });
    expect(diff.trafficSource).toBe('recorded'); // documented, not live
  });
});

// --- end verbatim transcription ---
