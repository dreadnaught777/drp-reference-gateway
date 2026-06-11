# Prod-readiness checks

Four checks runnable against the system today, beyond the transcribed suites
(A-M). They are a reproducible probe, not part of the frozen test plan.

- Run them: `npm run checks` (script: `scripts/prod-checks.ts`)
- Structured output: `docs/prod-checks-results.json`
- Randomness is seeded, so a run is reproducible.

Last run: Node v24.14.1, 4/4 checks passed. The numbers below are from that run
(`docs/prod-checks-results.json`).

## 1. Default-deny and receipt invariants (fuzz)

**What it tests.** 1000 random proposals - a mix of fixture-intent shapes and
"junk" proposals whose action and resource match no rule. For each it asserts:
default-deny fires for junk; the decision matches the fixture intent for known
shapes; every decision produces a receipt that verifies offline against
`/v1/keys`; and tampering with a sampled receipt breaks verification.

**What happened.** 562 deny, 269 allow, 169 escalate. `junkLeaked: 0` (no junk
proposal ever escaped default-deny), `oracleMismatch: 0` (every known shape
decided as intended), `receiptsVerified: 1000/1000`, and `tampersDetected:
20/20` (every tampered receipt failed verification). Pass.

## 2. Provider parity (fuzz, Cedar vs OPA)

**What it tests.** The same 1000 random proposals through a Cedar gateway and an
OPA gateway, asserting identical decisions. This stresses the provider
abstraction far beyond Suite B's seven fixed scenarios.

**What happened.** `mismatches: 0`. Cedar and OPA agreed on every proposal,
including the escalate cases (Cedar maps them through the manifest, OPA returns
them natively). Pass.

## 3. Long-run receipt-chain audit

**What it tests.** 3000 decisions into a fresh store, then a full walk of the
receipt chain in append order: every `prevHash` must equal the SHA-256 of the
prior receipt's canonical body, every signature must verify, and the first must
be `genesis`.

**What happened.** `chainLength: 3000`, `prevHashLinksOk: 3000/3000`,
`signaturesOk: 3000/3000`. The chain held end to end. Wall-clock for the 3000
decisions in this run was 2403 ms (~0.8 ms per decision including signing and
hashing). That figure is an observation from `npm run checks`, not a tuned
benchmark - a real throughput claim would need a dedicated harness under
`scripts/bench/` (see Further development). Pass.

## 4. Negative and malformed input over HTTP

**What it tests.** Six requests against the running HTTP server, asserting the
gateway returns proper errors rather than crashing, and that a deny stays a
200 (deny is not a transport error).

**What happened.** All six passed:

| Case | Expected | Got |
|---|---|---|
| invalid JSON body | 400 | 400 `bad-request` |
| unknown tool | 200 + `decision: deny` | 200, deny (`default-deny: no rule matched`) |
| proposal missing `resource` | 4xx, no crash | 400 `decide-failed` |
| `GET /v1/decide` (wrong method) | 404 | 404 |
| `GET /v1/nope` (unknown route) | 404 | 404 |
| `GET /v1/healthz` | 200 | 200 `{status: ok}` |

**Finding.** The "missing resource" case returns 400 (no crash, good), but the
message is an internal `TypeError` (`Cannot read properties of undefined`)
rather than a clean validation error. Input validation at the wire boundary
should reject a malformed proposal with a structured message before it reaches
the engine. Tracked under Further development (full HTTP control plane).

## Further development

Items that would extend the system beyond what runs today. None are required by
the conformance suite; each is a build-out.

**5. Full HTTP control plane.** The standalone server (`src/httpServer.ts`)
exposes only `/v1/decide`, `/v1/healthz` and `/v1/openapi.json`. Exposing the
rest of the surface - `/v1/decisions`, `/v1/state/{id}`, `/v1/policy/effective`,
`/v1/receipts/{ref}`, `/v1/keys`, `/v1/escalations`, the simulate endpoints, and
the DRP-layer `/v1/reconcile` and `/v1/conflicts` - would make the gateway
curl-able as a real control plane, let conformance validate live wire responses
end to end (Suite M samples in-process today), and give input validation a
single home (see the check-4 finding). The build brief names Fastify for this
layer (OpenAPI-from-schema); since the gateway serves the committed document
verbatim, a Fastify or a plain node:http control plane both fit.

**6. Benchmark harness.** A reproducible decide-latency and throughput harness
under `scripts/bench/`, comparing Cedar and OPA. The honesty rule (Suite L) is
that no latency or throughput number appears in the README or docs without
naming the script that produces it - so the harness must land before any
headline performance figure does. The chain-audit timing above is attributed to
`npm run checks` for exactly this reason.

**7. Real MCP stdio transport.** The proxy (`src/mcp/proxy.ts`) routes tool
calls through the decide pipeline in-process today. Wiring it to real downstream
MCP servers over stdio (or streamable-HTTP) using `@modelcontextprotocol/sdk`,
and running a real `tools/call` round-trip through it, would exercise the
transport the proxy is meant to sit on.

**8. Live PreToolUse hook.** The self-governing hook adapter
(`scripts/claude-code-hook/adapter.mjs`) is proven by an integration test. The
next step is to wire it into a live `.claude/settings.json` against a running
`npm run serve:gateway`, so the gateway governs the actual tool in a session -
the demo the essays describe.
