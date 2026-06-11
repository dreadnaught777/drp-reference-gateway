# Build brief: drp-reference-gateway

**For:** Claude Code. Implement this alongside two companion documents: `drp-reference-gateway-tests.md` (the authoritative test plan) and the protocol specification (`drp-runtime-protocol-v0.1.yaml` plus `drp-protocol-semantics-v0.1.md`). Precedence on observable behaviour: test plan first, protocol spec second, this brief third. Where they disagree, raise the discrepancy, do not silently resolve it.

**Spec-first rule.** The protocol spec is an INPUT to this build, not an output of it. The gateway implements the committed spec; conformance tests validate the live handlers against the committed YAML. Do not generate the protocol document from the handlers. Where implementation reveals the spec is wrong or incomplete, record the divergence in `spec/DIVERGENCES.md` for a v0.2 of the spec rather than quietly bending either side.

**Protocol/layer split.** The spec covers only the runtime-facing surface (decide, policy acceptance, readback, simulate, escalations, receipts, keys, contract). Reconcile and conflicts are DRP-layer functions the gateway additionally provides as a consumer of its own protocol; they live under /v1 for convenience but in separable modules, and they are not part of protocol conformance.

**Status:** v1 brief, 11 June 2026. Section numbering is load-fixed: the test plan refers to Section 5 (honesty acceptance criteria) and Section 6 (demo scenarios) by number. Do not renumber.

---

## 1. What this is, and what it is not

This is a reference implementation of Declarative Runtime Policy (DRP) at the smallest honest scope: an MCP-proxying policy gateway that demonstrates the five runtime interfaces the essay series argues for, including the one no commercial runtime ships - decision readback.

DRP, as defined in the series, is the layer that composes controls - their attributes, across principals and across time - so that a deny-by-default decision, at whatever point execution occurs, can evaluate context established elsewhere: by a different principal, at a different moment, in a different engine. This gateway is one enforcement point implementing that layer's contract, not the layer itself. It exists to prove the interfaces are buildable and to give the essays a running artefact, not to be deployed in production.

The build's first principle is honesty. The series stakes its credibility on distinguishing what is buildable today from what is not. The gateway therefore implements real versions of the buildable rungs, and for the unbuildable residue it implements the *limit* - an explicit, tested refusal or an after-the-fact flag - rather than a fake. Section 5 makes this contractual. A test that passes by overclaiming is a defect of release-blocking severity.

Three sentences of orientation for the implementing agent. The decide path is the spine: every action proposal, whether it arrives over HTTP or through the MCP proxy, flows through one decision pipeline and out the other side as a signed receipt. Everything else - readback, simulation, reconciliation - is a different way of querying or replaying what that pipeline produced or would produce. If a design question arises, resolve it in favour of keeping the decide path singular and everything else derived from it.

## 2. Architecture

```
                      ┌─────────────────────────────────────────────┐
                      │              drp-reference-gateway          │
                      │                                             │
  MCP client ───────▶│  MCP proxy ──┐                              │
  (agent harness)     │  (server side│                              │
                      │   + client   │     ┌──────────────────┐    │──────▶ downstream
  HTTP caller ──────▶│   side)      ├────▶│  Decide pipeline │    │        MCP servers
  (/v1 control plane) │              │     │                  │    │        (stubs in test)
                      │  /v1 API ────┘     │ assemble input   │    │
                      │                    │ → providers      │    │
                      │                    │ → arbitrate      │    │
                      │                    │ → decide         │    │
                      │                    │ → receipt/sign   │    │
                      │                    │ → store + OTel   │    │
                      │                    └────────┬─────────┘    │
                      │                             │              │
                      │   Providers:        ┌───────▼────────┐     │
                      │   cedar (wasm)      │  Decision store │     │
                      │   opa   (wasm)      │  (SQLite)       │     │
                      │                     │  receipts chain │     │
                      │                     └────────────────┘     │
                      └─────────────────────────────────────────────┘
```

Components:

- **MCP proxy.** The gateway presents as an MCP server to the agent harness and acts as an MCP client to one or more downstream servers. Every `tools/call` it receives is converted to an ActionProposal and put through the decide pipeline. `allow` forwards the call downstream and returns the result. `deny` and `escalate` return a tool error to the caller and the call never reaches downstream.
- **/v1 control plane.** HTTP API carrying the five interfaces: decide (enactment), decisions/state/policy-effective (readback), simulate (plan), reconcile, plus policy loading, escalation resolution, conflicts, keys, and the OpenAPI document.
- **Decide pipeline.** Single code path: validate proposal → assemble engine input (principal, action, resource, carried context) → evaluate against one or more policy sources via providers → arbitrate if more than one source → produce decision → sign and chain receipt → persist → emit OTel event → respond.
- **Providers.** Two engine adapters behind one TypeScript interface: Cedar (embedded WASM) and OPA (embedded WASM). Parity between them on a shared scenario set is the proof that the provider abstraction is real (test Suite B).
- **Decision store.** SQLite. Holds receipts (the chain), decisions (queryable projections), escalations, conflicts, and policy bundle versions. The store is what makes readback an interface rather than a log.

## 3. Technology assumptions

All verified against reference documentation as of 11 June 2026. Pin major versions; take minors freely.

| Concern | Choice | Why | Reference |
|---|---|---|---|
| Runtime | Node 22 LTS, TypeScript 5.x, ESM | Test plan mandates Node 22+; native Ed25519 in `node:crypto` | nodejs.org/api/crypto.html |
| Test framework | Vitest | Mandated by the test plan | vitest.dev |
| HTTP layer | Fastify 5 + `@fastify/swagger` | Routes declared with JSON Schema generate the OpenAPI document from the live handlers, which is exactly what Suite J asserts | fastify.dev, github.com/fastify/fastify-swagger |
| Cedar engine | `@cedar-policy/cedar-wasm` (`/nodejs` subpackage) | Official Cedar WASM bindings: authorisation (`isAuthorized`), policy parsing, and schema-based validation in-process | npmjs.com/package/@cedar-policy/cedar-wasm |
| OPA engine | `@open-policy-agent/opa-wasm` | Official OPA SDK for evaluating Rego compiled to WASM in-process; avoids a sidecar in the test environment | github.com/open-policy-agent/npm-opa-wasm |
| Rego compilation | `opa` CLI, `opa build -t wasm -e drp/decision` | Produces the WASM bundle the provider loads. Dev-time dependency only; fixtures ship both `.rego` source and compiled `.wasm`, with an npm script to rebuild | openpolicyagent.org/docs/wasm |
| MCP | `@modelcontextprotocol/sdk` v1.x | The production-recommended line (v2 is expected with the 2026-07-28 spec; do not target it). Provides both `McpServer` and client + stdio/streamable-HTTP transports needed for the proxy and the test stubs | github.com/modelcontextprotocol/typescript-sdk |
| Canonicalisation | `canonicalize` (RFC 8785 JCS) | Stable signatures across key ordering, per Suite C | npmjs.com/package/canonicalize |
| Signing | Ed25519 via `node:crypto` (`generateKeyPair`, `sign`, `verify`) | No external dependency; verifiable offline by the test helper | nodejs.org/api/crypto.html |
| Store | `better-sqlite3` | Synchronous, zero-config, queryable for readback and reconciliation replay | npmjs.com/package/better-sqlite3 |
| Telemetry | `@opentelemetry/api` + `@opentelemetry/sdk-node`; in-memory exporter in tests | Suite C asserts a `drp.decision` event reaches the configured exporter | opentelemetry.io/docs/languages/js |
| Identity format | SPIFFE ID strings (`spiffe://trust-domain/path`) | Fixtures only; no live SPIRE. The principal model is exercised, the issuance path is out of scope | spiffe.io/docs/latest/spiffe-about/spiffe-concepts |
| Trace propagation | W3C Trace Context `traceparent` | Correlates chained decisions in Suite I | w3.org/TR/trace-context |

Assumptions to hold rather than revisit mid-build: embedded engines over sidecars (test determinism beats production realism here); SQLite over Postgres (single-file state suits a reference); Fastify over Hono (OpenAPI-from-schema is the deciding feature). If any package proves unworkable, stop and flag rather than substituting silently - the technology table is part of what the essays cite.

## 4. Requirements: six rungs, five interfaces

The essays define five runtime interfaces (1 enactment, 2 decision-readback, 3 context propagation, 4 simulation, 5 versioned protocol) and the DRP rungs. The build decomposes into requirements R1-R6. Each maps to test suites per the table at the end of the test plan.

**R1 - Enactment core (Interface 1).** `POST /v1/decide` accepts an ActionProposal and returns `allow | deny | escalate` with `decisionId`, `reason`, `receiptRef`, `provider`, `principal`. Default-deny: no matching rule means `deny`, never `allow`. The MCP proxy routes every proxied tool call through this same path; a deny or escalate must prevent the downstream call entirely (assert via stub-server recording). `escalate` holds the action: it is recorded in an escalations queue and does not execute unless resolved with an approval via `POST /v1/escalations/{id}`.

**R2 - Provider model (the showcase).** One TypeScript provider interface, two implementations (Cedar, OPA), one shared intent encoded in both `fixtures/policy.cedar` and `fixtures/policy.rego`: read-path allowed in sandbox, write/delete and remote-contacting calls escalate, one egress allow-list domain, default-deny. The parity suite runs the same proposals through both engines and requires identical decisions. Every decision response carries which provider produced it.

**R3 - State and receipts (Interface 3's record half).** Every decision produces a receipt: JCS-canonicalised, SHA-256 hashed, Ed25519-signed, and chained (`prevHash` = hash of the prior canonicalised receipt). Receipts verify offline against the key published at `GET /v1/keys`. Tampering with any field breaks verification. Each decision also emits an OTel event named `drp.decision`.

**R4 - Plan-before-apply (Interface 4).** Two modes. Mode (a), action simulation: `POST /v1/simulate/action` runs the full decide pipeline with execution suppressed - same decision, no downstream call, receipt marked `simulated: true`. Mode (b), policy simulation: `POST /v1/simulate/policy` loads a candidate policy in shadow, replays `recordedTraffic.jsonl` (past proposals with their original decisions), and returns the diff: which recorded decisions flip, from what to what, and how many are unchanged. The response must carry `trafficSource: "recorded"` - the documented limit that this replays history, not a live production shadow. Additionally, policy load runs validation: for Cedar, schema validation via cedar-wasm plus a contradiction probe (a policy set in which a permit and a forbid have identical scope, or which cannot produce any decision other than the default on the canonical probe set, is rejected with an error matching `/unsatisfiable|contradict/i`). Be precise in code comments and README: this is static validation plus probe-based checking, not SMT-based automated reasoning of the kind AWS runs - do not describe it otherwise.

**R5 - Reconciliation (flag-for-review only).** `POST /v1/reconcile` replays stored receipts since a timestamp against the currently intended policy and known patterns, and returns flags: `{ kind, status: 'for-review', ... }`. Drift kind: a stored decision that the current policy would decide differently. Pattern kind: `provenance-laundering` - an artefact write by one principal followed by a read of the same artefact by a different principal across the window, detectable only in the receipt history. Hard rule, asserted by Suite F: reconcile NEVER mutates, reverts, or emits any action. `actionsTaken` is always `[]` and no revert field exists. This encodes the series' position that security readback feeds flag-for-review, not auto-revert.

**R6 - Arbitration (within one vocabulary).** A decide request may name multiple policy sources. Two resolvers: `most-restrictive` (deny beats escalate beats allow) and `priority` (explicit order wins regardless of strictness). The decision carries `arbitration.winner`; every disagreement is recorded and queryable at `GET /v1/conflicts`. The limit is contractual: two sources in the same schema resolve; sources from different framework vocabularies are rejected with an error matching `/cross-framework arbitration not supported/i`. Cross-framework arbitration semantics are precisely what the essays say nobody has built; this gateway does not pretend to have built them.

**Interface 2 - decision readback (the whole point).** Three endpoints. `GET /v1/decisions?principal=` lists decisions with filters. `GET /v1/state/{decisionId}` returns the receipt reference plus the state the decision assumed: at minimum `policyVersion` and `principal`, plus the carried context evaluated. `GET /v1/policy/effective?principal=` returns the rules currently in force for a principal and the bundle version, and the version must change when policy is reloaded. Implementation note: effective-policy readback is served from the gateway's own bundle manifest (Section 8), not from engine introspection - Rego is not cleanly introspectable per principal, and the manifest approach keeps readback engine-agnostic, which is itself the architectural claim.

**Interface 3 - context propagation.** Every decision response includes a `contextToken`: a signed, base64url-encoded record `{ decisionId, principal, action, decision, policyVersion, iat }` (Ed25519, same key family as receipts). A subsequent proposal may carry it as `priorContext` alongside a W3C `traceparent`. The pipeline verifies the token; a valid one is exposed to policy as input (enabling the composite-chain scenario), an invalid or tampered one sets `contextTrusted: false` and is excluded from policy input. This is a single-gateway demonstration of carriage, and the README must say so: cross-organisation, cross-engine carriage is the unsolved residue the essays name.

**Interface 5 - versioned protocol.** Everything under `/v1`. `GET /v1/openapi.json` serves the OpenAPI document generated from the live Fastify schemas, version `1.x`.

**Cross-principal scope.** Principals are SPIFFE IDs across the fixture set: agent, workload, delegated human (OIDC→SPIFFE, response carries `identitySource: "delegated"`), and artefact (identified by its in-toto attestation subject). Devices are deliberately partial: a device principal decides, but the response carries `principalCoverage: "partial"`. Do not model devices as a fifth equal type; the gradient is documented and tested.

## 5. Honesty acceptance criteria (release-blocking)

These mirror test Suite L one-for-one. The build fails review if any is faked, even with all other tests green.

1. **Cross-framework arbitration is rejected, not approximated.** A decide request mixing vocabularies returns an error matching `/cross-framework arbitration not supported/i`. No heuristic mapping, no silent best-effort.
2. **Async provenance laundering is allowed inline.** Both halves of the write-then-read chain decide `allow` at decision time, because no single inline decision can see both. The compensating control is the reconciliation flag, after the fact. If a change makes the inline path "catch" this case, treat it as a regression of the test's honesty, not a win, and investigate.
3. **Cross-principal-baseline anomaly is not caught inline.** An action anomalous only relative to another principal's baseline is not denied; the response carries `limitations: [..., 'cross-principal-baseline']`.
4. **The model is untrusted, and so is the tool.** The gateway gates the *declared* action. A downstream tool that internally diverges from its declaration is not caught, and the decision response says so: `gatedOn: "declared-action"`. This is the model/harness dependency the essays name; encode it, do not hide it.
5. **No unbenchmarked performance claims.** Any latency or throughput number in the README or docs must name a reproducible benchmark script in the repo. If there is no benchmark, there is no number.
6. **Devices are partial.** `principalCoverage: "partial"` for device principals, everywhere, including docs.

Writing style for all user-facing text in the repo (README, errors, comments destined for the essays): UK English; no em-dashes, use a spaced hyphen; avoid the words genuinely, load-bearing, signal, sharp, honestly, actually, robust, ultimately.

## 6. Demo scenarios

Three end-to-end scenarios, mapping to the essays' enforceable/unsolved split. They double as the demo script for the published piece.

**Scenario 1 - trusted-channel exploit (enforceable inline).** The egress domain is allow-listed, but the call carries protected data out through that permitted path. Policy binds the grant to capability, not destination: the decision is `deny`, the reason text references the capability-grant framing (`/capability grant|not a destination filter/i`), and the stub egress server receives nothing. This is the series' egress-incident anchor, enforced.

**Scenario 2 - cross-principal synchronous chain (enforceable inline).** Read-CRM decides `allow` - innocuous alone. The subsequent send-external proposal arrives carrying the read's contextToken; policy sees the prior decision in its input and the composite decides `deny`. Neither call is anomalous in isolation; the carriage is what catches it. This is the demonstration that granularity plus carried context closes the synchronous cross-hop case.

**Scenario 3 - async provenance laundering (NOT enforceable inline).** Artefact written by the workload principal at t1; read by the agent principal at t2. Both decide `allow` inline - the documented limit. Reconciliation over the receipt history flags `provenance-laundering`, `for-review`. The limit and the compensating flag are both tested; the scenario exists to show the edge of the claim, which the essays state as the thing building DRP would settle.

## 7. The /v1 API contract

All request/response bodies are JSON, schemas declared in Fastify so the OpenAPI document is generated, not hand-written.

| Method, path | Purpose |
|---|---|
| POST /v1/decide | Enactment. Body: ActionProposal (+ optional `sources`, `resolver`, `order`). Returns Decision |
| POST /v1/policy | Load/replace a policy bundle (validates; may reject) |
| GET /v1/policy/effective?principal= | Readback: rules in force for a principal + bundle version |
| GET /v1/decisions?principal=&since=&decision= | Readback: decision list |
| GET /v1/state/{decisionId} | Readback: receipt ref + assumed state |
| POST /v1/simulate/action | Plan mode (a): decision without effect |
| POST /v1/simulate/policy | Plan mode (b): candidate policy vs recorded traffic diff |
| POST /v1/reconcile | Drift + pattern flags since timestamp; never mutates |
| GET /v1/conflicts | Arbitration disagreements recorded |
| GET /v1/escalations, POST /v1/escalations/{id} | Pending escalations; resolve approve/deny |
| GET /v1/receipts/{ref} | Fetch a receipt for offline verification |
| GET /v1/keys | Published Ed25519 public key(s) |
| GET /v1/openapi.json | The generated contract |
| GET /v1/healthz | Liveness |

## 8. Data formats

**ActionProposal**
```json
{
  "principal": "spiffe://demo/agent/email-helper",
  "identitySource": "native",
  "tool": "read_file",
  "args": { "path": "sandbox/notes.txt" },
  "resource": { "kind": "file", "id": "sandbox/notes.txt" },
  "declaredAction": "read",
  "context": {
    "traceparent": "00-<trace-id>-<span-id>-01",
    "priorContext": "<base64url signed token or absent>"
  }
}
```

**Decision (response)**
```json
{
  "decision": "allow",
  "decisionId": "d_01J...",
  "reason": "matched rule sandbox-read-allow",
  "receiptRef": "r_01J...",
  "provider": "cedar",
  "principal": "spiffe://demo/agent/email-helper",
  "identitySource": "native",
  "principalCoverage": "full",
  "policyVersion": "sha256:ab12...",
  "contextToken": "<base64url>",
  "traceparent": "00-...",
  "sawPriorContext": false,
  "contextTrusted": null,
  "gatedOn": "declared-action",
  "limitations": [],
  "arbitration": null
}
```
`arbitration`, when multiple sources were evaluated: `{ "winner": "strict", "resolver": "most-restrictive", "disagreed": true }`.

**Receipt** (the canonicalised, signed unit; stored and chained)
```json
{
  "v": 1,
  "receiptId": "r_01J...",
  "decisionId": "d_01J...",
  "ts": "2026-06-11T10:42:00.000Z",
  "principal": "spiffe://demo/agent/email-helper",
  "action": { "tool": "read_file", "declaredAction": "read", "resource": "sandbox/notes.txt" },
  "decision": "allow",
  "reason": "matched rule sandbox-read-allow",
  "provider": "cedar",
  "policyVersion": "sha256:ab12...",
  "assumed": { "policyVersion": "sha256:ab12...", "principal": "spiffe://demo/agent/email-helper", "priorContext": null },
  "simulated": false,
  "prevHash": "sha256:9f31..."
}
```
Signature: Ed25519 over SHA-256 of the JCS canonicalisation, carried alongside as `{ sig, keyId }` (the signature is not inside the signed body). `prevHash` is the SHA-256 of the prior receipt's canonicalised body; the first receipt uses the literal `"genesis"`.

**Policy bundle manifest** (`drp.manifest.json`, shipped beside the policy files; the source of engine-agnostic readback)
```json
{
  "bundleVersion": "sha256:<hash of policy files>",
  "vocabulary": "drp-demo-v1",
  "engine": "cedar",
  "rules": [
    { "id": "sandbox-read-allow", "principals": ["spiffe://demo/agent/*"], "effect": "allow", "summary": "read-path in sandbox" },
    { "id": "write-escalate", "principals": ["*"], "effect": "escalate", "summary": "write/delete escalates" },
    { "id": "egress-allowlist", "principals": ["*"], "effect": "allow", "summary": "one permitted egress domain, capability-bound" }
  ]
}
```
`vocabulary` is what arbitration compares: sources with differing vocabularies are the cross-framework case and are rejected (Section 5, criterion 1).

**recordedTraffic.jsonl** - one JSON object per line: `{ proposal, decision, decisionId, ts }`. Fixture provided; simulate mode (b) and reconciliation both consume it (reconciliation consumes the live store; the fixture seeds tests).

## 9. The provider contract

```ts
export interface DrpProvider {
  readonly name: 'cedar' | 'opa';
  /** Validate and load a bundle; throw on contradiction/unsatisfiability (R4). */
  load(bundle: PolicyBundle): Promise<LoadedPolicy>;
  /** Pure decision: no side effects, no store access. */
  evaluate(input: EngineInput, policy: LoadedPolicy): Promise<EngineDecision>;
}

export interface EngineInput {
  principal: string;          // SPIFFE ID or attestation subject
  declaredAction: string;
  tool: string;
  resource: { kind: string; id: string };
  args: Record<string, unknown>;
  priorContext: PriorContext | null;  // only if signature verified
}

export interface EngineDecision {
  effect: 'allow' | 'deny' | 'escalate';
  matchedRuleId: string | null;       // null means default-deny fired
  reason: string;
}
```

Cedar adapter: map principal/action/resource onto Cedar entities; evaluate with `isAuthorized`; `forbid` and no-match both surface as deny, distinguished in `reason`. Escalation is modelled as a permit on a distinguished action context flag (Cedar has no third effect; the adapter maps a matched `escalate`-tagged rule, identified via the manifest, to `effect: 'escalate'`). OPA adapter: entrypoint `drp/decision` returns `{ effect, rule, reason }` directly from Rego; compile fixtures with `opa build -t wasm -e drp/decision`. The parity requirement (Suite B) is the check that both adapters encode the shared intent identically; when they diverge, fix the adapter or the fixture, never the test.

## 10. Repository layout, milestones, build order

```
drp-reference-gateway/
  spec/
    drp-runtime-protocol-v0.1.yaml   # committed protocol (input, not generated)
    drp-protocol-semantics-v0.1.md   # normative behaviour
    DIVERGENCES.md                   # build findings feeding spec v0.2
  src/
    server.ts              # Fastify wiring, /v1 routes
    pipeline/decide.ts     # the single decide path
    providers/{cedar,opa}.ts
    providers/types.ts
    mcp/proxy.ts           # MCP server+client proxy
    state/{store,receipts,chain}.ts
    context/token.ts       # contextToken sign/verify
    simulate/{action,policy}.ts
    reconcile/{drift,patterns}.ts    # layer-side, not protocol
    arbitrate/resolvers.ts           # layer-side, not protocol
    otel.ts
  fixtures/
    policy.cedar  policy.rego  policy.wasm  drp.manifest.json
    recordedTraffic.jsonl
    principals.ts
  test/                    # per the test plan, suites A-L + support/
    conformance/           # live handlers vs committed spec
  scripts/
    build-rego.sh          # opa build -t wasm -e drp/decision
    bench/                 # any reported number lives here
  README.md
```

Milestones, each gated on named suites going green:

- **M0** - commit the protocol spec into `spec/` unchanged; scaffold, fixtures, test harness (`createGateway`, stub MCP servers, `verifyReceipt`, stub model). No suites yet; harness compiles.
- **M1** - decide pipeline + Cedar provider + MCP proxy + escalations. Gate: Suite A.
- **M2** - receipts (JCS, Ed25519, chain), store, OTel, readback endpoints. Gate: Suites C, D.
- **M3** - OPA provider + parity. Gate: Suite B.
- **M4** - simulate, both modes + Cedar load-time validation. Gate: Suite E.
- **M5** - reconcile (drift + provenance-laundering pattern) + arbitration resolvers + conflicts. Gate: Suites F, G.
- **M6** - context tokens + cross-principal fixtures + the three demo scenarios. Gate: Suites H, I, K.
- **M7** - serve the committed spec at /v1/openapi.json, conformance suite (live handlers vs committed YAML), honesty pass, README, DIVERGENCES.md complete. Gate: Suites J, L; full suite green. Note on Suite J: its assertions (paths present, version 1.x) pass unchanged; implement them by serving the committed document and validating handler responses against it, not by generating the document from handlers.

Stretch, only after M7: a Claude Code PreToolUse hook adapter (a small script that POSTs the hook's tool-call JSON to `/v1/decide` and maps deny to the hook's deny output), so the gateway can govern the tool that built it. Worth a paragraph in the essays if it lands; not part of acceptance.

## 11. Out of scope

Production identity (no live SPIRE; SPIFFE IDs are fixtures). Throughput and concurrency targets. A real LLM in the loop. Cross-framework arbitration semantics. Inline prevention of the async classes. Live production traffic shadowing in simulate mode (b). Multi-gateway, cross-engine context carriage. Persistence migrations, auth on the control plane, deployment packaging. Every one of these is either the documented limit the essays name or operational weight a reference does not need.

## 12. References

- Cedar WASM bindings: https://www.npmjs.com/package/@cedar-policy/cedar-wasm and https://github.com/cedar-policy/cedar (cedar-wasm crate)
- OPA WASM SDK: https://github.com/open-policy-agent/npm-opa-wasm and https://www.openpolicyagent.org/docs/wasm
- MCP TypeScript SDK (v1.x): https://github.com/modelcontextprotocol/typescript-sdk
- MCP specification (current + 2026-07-28 RC): https://modelcontextprotocol.io/specification/
- RFC 8785 JSON Canonicalization Scheme: https://www.rfc-editor.org/rfc/rfc8785 (npm `canonicalize`)
- Node crypto (Ed25519): https://nodejs.org/api/crypto.html
- Fastify + swagger: https://fastify.dev and https://github.com/fastify/fastify-swagger
- SPIFFE concepts: https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/
- W3C Trace Context: https://www.w3.org/TR/trace-context/
- OpenTelemetry JS: https://opentelemetry.io/docs/languages/js/
- in-toto attestations (artefact subjects): https://github.com/in-toto/attestation
- Companion test plan: `drp-reference-gateway-tests.md` (authoritative on observable behaviour)
