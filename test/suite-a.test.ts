/**
 * Suite A - MCP proxy and /v1/decide core (Interface 1; R1).
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite A,
 * including the escalation lifecycle block. The describe/it bodies below are
 * the frozen test plan; the preamble (imports and per-test wiring) binds the
 * harness symbols the plan references. Test files are immutable after
 * transcription (CLAUDE.md): a failure is fixed in src/, never here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGateway, type GatewayHandle } from './support/createGateway';
import { readFileProposal, writeFileProposal, proposal } from './support/proposals';
import { emptyBundle } from './support/bundles';
import { humanId } from '../fixtures/principals';

let client: GatewayHandle;
let files: GatewayHandle['files'];
let proxy: GatewayHandle['proxy'];

beforeEach(() => {
  const gw = createGateway({ provider: 'cedar' });
  client = gw;
  files = gw.files;
  proxy = gw.proxy;
});

// --- begin verbatim transcription (test plan Suite A) ---

describe('decide: core enforcement', () => {
  it('allows a read-path call that matches an allow rule, and the call reaches downstream', async () => {
    const r = await client.decide(readFileProposal('sandbox/notes.txt'));
    expect(r.decision).toBe('allow');
    expect(files.received).toContainEqual(expect.objectContaining({ tool: 'read_file' }));
  });

  it('denies by default when no rule matches', async () => {
    const r = await client.decide(proposal({ tool: 'exotic_tool' }));
    expect(r.decision).toBe('deny');
    expect(files.received).toHaveLength(0); // never reached downstream
  });

  it('denies everything under an empty policy bundle (default-deny needs no rules)', async () => {
    const empty = createGateway({ provider: 'cedar', policy: emptyBundle });
    const r = await empty.decide(readFileProposal('sandbox/notes.txt'));
    expect(r.decision).toBe('deny');
  });

  it('escalates a write-path call and does not execute until resolved', async () => {
    const r = await client.decide(writeFileProposal('sandbox/out.txt'));
    expect(r.decision).toBe('escalate');
    expect(files.received).toHaveLength(0);
  });

  it('returns a decision id, a reason, and a receipt reference on every decision', async () => {
    const r = await client.decide(readFileProposal('sandbox/notes.txt'));
    expect(r.decisionId).toMatch(/.+/);
    expect(r.reason).toMatch(/.+/);
    expect(r.receiptRef).toMatch(/.+/);
  });

  it('proxied MCP tool calls route through decide (deny blocks the proxy path too)', async () => {
    await expect(proxy.callTool('delete_file', { path: 'sandbox/x' }))
      .rejects.toThrow(/denied|escalate/i);
    expect(files.received).toHaveLength(0);
  });

  it('proxied MCP tool calls that are allowed pass through and return the downstream result', async () => {
    const out = await proxy.callTool('read_file', { path: 'sandbox/notes.txt' });
    expect(files.received).toContainEqual(expect.objectContaining({ tool: 'read_file' }));
    expect(out).toBeDefined(); // downstream response surfaces to the caller
  });
});

describe('escalation lifecycle', () => {
  it('an approved escalation executes the held action downstream', async () => {
    const r = await client.decide(writeFileProposal('sandbox/out.txt'));
    expect(r.decision).toBe('escalate');
    expect(files.received).toHaveLength(0);
    await client.resolveEscalation(r.decisionId, { resolution: 'approve', resolvedBy: humanId });
    expect(files.received).toContainEqual(expect.objectContaining({ tool: 'write_file' }));
  });

  it('a denied escalation discards the held action; it never executes', async () => {
    const r = await client.decide(writeFileProposal('sandbox/out2.txt'));
    await client.resolveEscalation(r.decisionId, { resolution: 'deny', resolvedBy: humanId });
    expect(files.received).toHaveLength(0);
  });

  it('resolution produces its own receipt attributing the resolving principal', async () => {
    const r = await client.decide(writeFileProposal('sandbox/out3.txt'));
    const res = await client.resolveEscalation(r.decisionId, { resolution: 'approve', resolvedBy: humanId });
    const receipt = await client.receipt(res.receiptRef);
    expect(receipt.receipt.principal).toBe(humanId);
  });
});

// --- end verbatim transcription ---
