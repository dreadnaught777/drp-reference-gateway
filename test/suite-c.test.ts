/**
 * Suite C - State / receipts (R3; Interface 3 record half).
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite C.
 * The describe/it bodies below are the frozen test plan; the preamble binds the
 * harness symbols (client, gatewayPubKey, otelExporter) and imports the helpers
 * the plan references. Immutable after transcription (CLAUDE.md): fix in src/.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGateway, type GatewayHandle } from './support/createGateway';
import { verifyReceipt } from './support/verifyReceipt';
import { readFileProposal, p1, p2 } from './support/proposals';
import { hash, jcs, sampleA, reorderKeys } from './support/receiptHelpers';
import { createOtelHarness, type RecordedEvent } from './support/otel';

let client: GatewayHandle;
let gatewayPubKey: string;
let otelExporter: { events: RecordedEvent[] };

beforeEach(() => {
  const otel = createOtelHarness();
  const gw = createGateway({ provider: 'cedar', tracer: otel.tracer });
  client = gw;
  gatewayPubKey = gw.publicKey;
  otelExporter = otel.exporter;
});

// --- begin verbatim transcription (test plan Suite C) ---

describe('decision state: signed, chained, tamper-evident', () => {
  it('produces an Ed25519 signature that verifies offline against the published key', async () => {
    const { receipt } = await client.decideAndFetchReceipt(readFileProposal());
    expect(verifyReceipt(receipt, gatewayPubKey)).toBe(true);
  });

  it('the verification key is published at /v1/keys and is the key receipts verify against', async () => {
    const { keys } = await client.keys();
    const active = keys.find(k => !k.retired);
    expect(active.alg).toBe('Ed25519');
    const { receipt } = await client.decideAndFetchReceipt(p1());
    expect(verifyReceipt(receipt, active.publicKey)).toBe(true);
  });

  it('chains receipts: each carries the prior receipt hash', async () => {
    const a = await client.decideAndFetchReceipt(p1());
    const b = await client.decideAndFetchReceipt(p2());
    expect(b.receipt.prevHash).toBe(hash(a.receipt));
  });

  it('the first receipt in a fresh store carries the literal genesis marker', async () => {
    const fresh = createGateway({ provider: 'cedar' });
    const { receipt } = await fresh.decideAndFetchReceipt(p1());
    expect(receipt.prevHash).toBe('genesis');
  });

  it('detects tampering: mutating a receipt breaks chain verification', async () => {
    const a = await client.decideAndFetchReceipt(p1());
    const tampered = { ...a.receipt, decision: 'allow' }; // flip a denied decision
    expect(verifyReceipt(tampered, gatewayPubKey)).toBe(false);
  });

  it('canonicalises with JCS so signatures are stable across key ordering', () => {
    expect(jcs(sampleA)).toBe(jcs(reorderKeys(sampleA)));
  });

  it('emits the receipt as an OpenTelemetry event to the configured exporter', async () => {
    await client.decide(readFileProposal());
    expect(otelExporter.events).toContainEqual(expect.objectContaining({ name: 'drp.decision' }));
  });
});

// --- end verbatim transcription ---
