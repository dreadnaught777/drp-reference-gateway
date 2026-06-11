# Test plan: drp-reference-gateway

**For:** Claude Code, to implement alongside the build brief and the protocol specification (`drp-runtime-protocol-v0.1.yaml` + `drp-protocol-semantics-v0.1.md`).
**Precedence on observable behaviour:** this test plan first, protocol spec second, brief third. Discrepancies are raised, not silently resolved.
**Framework:** Vitest (TypeScript, Node 22+). HTTP control-plane tested through the handler layer; MCP proxying tested against two stub downstream servers.

**Revision: v2, 11 June 2026.** Amendments over v1:

- Suite J rewritten for spec-first: the gateway serves the committed protocol document and conforms to it; it does not generate the document from handlers. The version assertion now compares against the committed spec rather than hardcoding `1.x` (the committed spec is 0.1.0; the old `/^1\./` assertion would have failed against it).
- New Suite M - protocol conformance, including the readback-conformance level claim and the DIVERGENCES.md honesty mechanism.
- Mapping table interface numbers aligned to the essays and the spec: 1 enactment, 2 readback, 3 context (carriage and record), 4 simulation, 5 protocol. v1 had receipts and the chain token mapped inconsistently.
- Coverage added for gaps found on review: escalation resolution lifecycle, simulated receipts, simulate/decide parity, rejected-bundle isolation, assumed-state version pinning, the proxy allow path, empty-bundle default-deny, key publication, and exclusion-not-rejection semantics for untrusted context.

These tests do two jobs. Most verify the gateway *does* what it claims. A second group verifies it correctly *does not* do what it cannot do honestly - the documented limitations. Those tests pass by asserting the limited behaviour (e.g. an inline `allow` on a case nobody can catch inline) plus the compensating after-the-fact flag. If one of those tests starts failing because the gateway suddenly "catches" the case, that is a prompt to check the test is not being gamed, not a win.

A test that overclaims is a defect of equal severity to a feature that does not work. Treat the acceptance group in Suite L as release-blocking, and Suite M's divergence rule as part of it.

---

## 0. Test harness and fixtures

Implement these once under `test/support/`.

- `createGateway(opts)` - boots an in-process gateway with a chosen provider (`'cedar' | 'opa'`), a loaded policy set, and stub identity. Returns a client for the `/v1` API and a handle to assert on downstream calls. Booting with `{ defaultEffect: 'allow' }` or any equivalent option MUST throw: default-deny is not configurable.
- `stubMcpServer(name)` - a downstream MCP server recording every tool call it actually receives, so tests can assert a call did or did not reach it.
- Two stub servers: `files` (read/write/delete file tools) and `egress` (an HTTP-fetch tool standing in for the allow-listed destination).
- Policy fixtures in both languages: `fixtures/policy.cedar` and `fixtures/policy.rego`, encoding the same intent: read-path allowed in sandbox; write/delete and remote-contacting calls escalate; an egress allow-list entry for one domain; default-deny.
- Principal fixtures as SPIFFE IDs: `spiffe://demo/agent/email-helper`, `spiffe://demo/workload/etl`, a human delegated via OIDC→`spiffe://demo/human/alice`, and an artefact represented by its in-toto attestation subject.
- `recordedTraffic.jsonl` - a sample of past action proposals with their decisions, for simulate-mode-b and reconciliation.
- `verifyReceipt(receipt, pubkey)` - offline Ed25519 + JCS verification helper, so receipt tests do not depend on the gateway to check the gateway.
- `committedSpec()` - loads and parses `spec/drp-runtime-protocol-v0.1.yaml` from the repo, for Suites J and M.
- A stub model: no real LLM key required to run the suite.

---

## Suite A - MCP proxy and `/v1/decide` core

```ts
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
```

## Suite B - Provider model (R2, the showcase)

Run the same intent and the same proposals against both engines; assert identical decisions. This is the test that proves the provider abstraction holds rather than being asserted.

```ts
describe.each(['cedar', 'opa'])('provider parity: %s', (engine) => {
  const client = createGateway({ provider: engine });

  it('produces the same decision as the other engine for the shared scenario set', async () => {
    for (const p of sharedScenarioSet) {
      expect((await client.decide(p)).decision).toBe(expectedDecision(p));
    }
  });

  it('default-denies identically', async () => {
    expect((await client.decide(proposal({ tool: 'unknown' }))).decision).toBe('deny');
  });
});

it('a decision carries which provider produced it (for observability)', async () => {
  const r = await createGateway({ provider: 'cedar' }).decide(readFileProposal());
  expect(r.provider).toBe('cedar');
});
```

## Suite C - State / receipts (R3)

```ts
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
```

## Suite D - Readback (the observe side - the whole point)

```ts
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
```

## Suite E - Plan-before-apply (R4)

```ts
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
```

## Suite F - Reconciliation (R5, flag-for-review only)

```ts
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
```

## Suite G - Arbitration (R6, stub-and-flag)

```ts
describe('arbitration: within-vocabulary resolvers', () => {
  it('most-restrictive-wins: deny beats allow when two sources disagree', async () => {
    const r = await client.decide(proposal(), { sources: ['lenient', 'strict'], resolver: 'most-restrictive' });
    expect(r.decision).toBe('deny');
    expect(r.arbitration.winner).toBe('strict');
  });

  it('priority-ordered: the higher-priority source wins regardless of strictness', async () => {
    const r = await client.decide(proposal(), { sources: ['lenient', 'strict'], resolver: 'priority', order: ['lenient'] });
    expect(r.arbitration.winner).toBe('lenient');
  });

  it('records conflicts for observability', async () => {
    await client.decide(proposal(), { sources: ['lenient', 'strict'], resolver: 'most-restrictive' });
    const conflicts = await client.conflicts();
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('LIMITATION: resolves within one vocabulary, not across frameworks', async () => {
    // Two sources expressed in the SAME schema resolve.
    // Two sources from DIFFERENT framework vocabularies are rejected as unsupported,
    // because cross-framework arbitration semantics are not delivered here.
    await expect(
      client.decide(proposal(), { sources: ['cedar-policy', 'foreign-framework-X'] })
    ).rejects.toThrow(/cross-framework arbitration not supported/i);
  });
});
```

## Suite H - Identity and cross-principal scope

```ts
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
```

## Suite I - Context propagation across a chain

```ts
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
```

## Suite J - Versioned protocol (spec-first)

The committed protocol document in `spec/` is the contract; the gateway serves it and conforms to it. v1 of this plan had the gateway generating the document from its handlers - that direction is reversed, and the version assertion now follows the committed spec rather than a hardcoded `1.x`.

```ts
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
```

## Suite K - Demo scenarios (end-to-end, maps to the essay's enforceable/unsolved split)

```ts
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
```

## Suite L - Acceptance group: "must NOT fake" (release-blocking)

A single consolidated suite so a reviewer can read the boundary in one place. These mirror Section 5 of the brief.

```ts
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
```

## Suite M - Protocol conformance (spec-first)

New in v2. Suite J proves the committed document is served; this suite proves the implementation behaves as that document says, and that the spec-first discipline is being kept. Conformance failures here are spec-or-implementation defects and must end up either fixed or recorded in `spec/DIVERGENCES.md` - never silently absorbed.

```ts
describe('protocol conformance', () => {
  it('the committed spec parses as valid OpenAPI 3.1', () => {
    expect(() => validateOpenApi(committedSpec())).not.toThrow();
  });

  it('live responses validate against the committed schemas (sampled per endpoint)', async () => {
    // One representative call per protocol endpoint; each response body is
    // validated (ajv) against the response schema in the committed spec.
    for (const sample of protocolSamples) {
      const res = await sample.call(client);
      expect(validateAgainstSpec(sample.operationId, res)).toEqual({ valid: true, errors: [] });
    }
  });

  it('deny is not a transport error: a deny decision returns HTTP 200', async () => {
    const { status, body } = await client.rawDecide(proposal({ tool: 'exotic_tool' }));
    expect(status).toBe(200);
    expect(body.decision).toBe('deny');
  });

  it('the gateway is readback-conformant per semantics §8', async () => {
    // Enact level: decide, policy, escalations, receipts, keys, openapi.
    // Readback level adds: policy/effective, decisions, state, simulate.
    for (const path of READBACK_CONFORMANT_PATHS) {
      expect(await client.rawStatus(path)).not.toBe(404);
    }
  });

  it('layer functions are not claimed as protocol: reconcile and conflicts are absent from the committed spec', () => {
    const spec = committedSpec();
    expect(spec.paths).not.toHaveProperty('/reconcile');
    expect(spec.paths).not.toHaveProperty('/conflicts');
    // They exist on the gateway (Suites F, G) as DRP-layer functions; the split is the claim.
  });

  it('spec divergences are recorded, not silently resolved', () => {
    // The file must exist from M0. An empty findings section is a pass;
    // a behavioural difference between spec and implementation without an
    // entry here is a release-blocking defect.
    expect(fs.existsSync('spec/DIVERGENCES.md')).toBe(true);
  });
});
```

---

## Mapping: test suite → brief section / rung / interface

Interface numbering follows the essays and the protocol spec: 1 enactment, 2 decision-readback, 3 context (carriage, and receipts as its record half), 4 simulation, 5 versioned protocol.

| Suite | Verifies | Brief ref |
|---|---|---|
| A | Enactment, default-deny, proxy path, escalation lifecycle | Interface 1; R1 |
| B | Provider abstraction over two engines | R2 (showcase) |
| C | Signed, chained, tamper-evident receipts; key publication | R3; Interface 3 (record half) |
| D | Policy + decision readback; assumed-state version pinning | Interface 2 |
| E | Simulation (action + policy diff), validation, bundle isolation | R4; Interface 4 |
| F | Drift flagging, no auto-revert | R5 (layer-side) |
| G | Within-vocabulary resolvers + cross-framework limit | R6 (layer-side) |
| H | SPIFFE principals, cross-principal gradient | Cross-principal claim |
| I | Chain context token, tamper detection, exclusion semantics | Interface 3 (carriage); scenario 2 enabler |
| J | Committed contract served, versioned path | Interface 5 |
| K | Three demo scenarios, enforceable/unsolved split | Section 6 |
| L | Honesty acceptance criteria | Section 5 (release-blocking) |
| M | Spec conformance, protocol/layer split, divergence discipline | Spec-first rule; semantics §8 |

---

## What these tests deliberately do not cover

- **Throughput and concurrency under load.** This is a reference for interface shape, not a performance proof. Any latency figure must carry its benchmark (Suite L), but the suite does not assert performance targets.
- **A real LLM in the loop.** Tests run against a stub model; the gateway's job is gating declared actions, which does not require live inference.
- **Production identity infrastructure.** SPIFFE IDs are fixtures, not a running SPIRE deployment. The principal model is exercised; the issuance path is out of scope.
- **Key rotation.** `/v1/keys` publication is tested; the rotation lifecycle (retiring a key while old receipts stay verifiable) is specified in semantics §4 but deferred - a single static key is acceptable for v0.1, and a rotation test would be the first addition for v0.2.
- **Cross-domain context carriage.** Suite I exercises carriage within one gateway's trust domain, which is all v0.1 of the spec defines. Multi-gateway, cross-engine carriage is the unsolved residue the essays name; no test pretends otherwise.
- **The unsolved rungs as solved.** By design, no test asserts cross-framework arbitration, inline async-laundering prevention, or cross-principal-baseline detection succeeds. The tests that touch those assert the limit and the compensating after-the-fact flag where one exists.
