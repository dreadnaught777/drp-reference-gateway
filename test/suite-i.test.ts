/**
 * Suite I - Context propagation across a chain (Interface 3, carriage half).
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite I.
 * The describe/it bodies below are the frozen test plan; the preamble binds the
 * harness symbols. Immutable after transcription (CLAUDE.md): a failure is fixed
 * in src/, never here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGateway, type GatewayHandle } from './support/createGateway';
import { readCrmProposal, sendExternalProposal } from './support/proposals';
import { mutate } from './support/context';

let client: GatewayHandle;

beforeEach(() => {
  client = createGateway({ provider: 'cedar' });
});

// --- begin verbatim transcription (test plan Suite I) ---

describe('context propagation', () => {
  it('carries a signed prior-decision token from call A to call B via Trace Context', async () => {
    const a = await client.decide(readCrmProposal());          // call A
    const b = await client.decide(sendExternalProposal({ traceparent: a.traceparent, priorContext: a.contextToken }));
    expect(b.sawPriorContext).toBe(true);
  });

  it('detects a tampered context token and refuses to trust it', async () => {
    const a = await client.decide(readCrmProposal());
    const forged = mutate(a.contextToken);
    const b = await client.decide(sendExternalProposal({ priorContext: forged }));
    expect(b.contextTrusted).toBe(false);
  });

  it('an untrusted token is EXCLUDED, not auto-denied: base policy still decides', async () => {
    // Semantics §5: verification failure must not by itself deny. The forged token is
    // dropped from policy input, so the proposal is evaluated as if it carried no
    // prior context. Under the fixture intent (remote-contacting calls escalate),
    // that means escalate from base policy - not the composite deny, and not an
    // automatic deny for the bad token.
    const a = await client.decide(readCrmProposal());
    const b = await client.decide(sendExternalProposal({ priorContext: mutate(a.contextToken) }));
    expect(b.contextTrusted).toBe(false);
    expect(b.decision).toBe('escalate'); // base-policy outcome, policy-driven
  });
});

// --- end verbatim transcription ---
