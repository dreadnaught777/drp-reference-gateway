# drp-reference-gateway

A reference implementation of Declarative Runtime Policy (DRP) at the smallest
honest scope: an MCP-proxying policy gateway that demonstrates the five runtime
interfaces the essay series argues for, including the one no commercial runtime
ships - decision readback.

This gateway is one enforcement point implementing the DRP layer's contract,
not the layer itself. It exists to prove the interfaces are buildable and to
give the essays a running artefact, not to be deployed in production.

## What it does

Every action proposal - whether it arrives over HTTP `POST /v1/decide` or
through the MCP proxy - flows through a single decide pipeline and out the other
side as a signed receipt. The five interfaces are derived from that one path:

1. **Enactment.** `allow`, `deny` or `escalate` is rendered before the action
   executes. Default-deny: no matching rule means `deny`, and that default is
   not configurable. An `escalate` holds the action until it is resolved.
2. **Decision readback.** `/v1/decisions`, `/v1/state/{decisionId}` and
   `/v1/policy/effective` answer what was decided, under which policy version,
   on what assumed state - history, not the current moment.
3. **Context carriage and the record.** Each decision carries a signed
   `contextToken` a later hop can present as prior context, and produces a
   JCS-canonicalised, SHA-256, Ed25519 receipt chained by `prevHash` (the first
   is the literal `genesis`), verifiable offline against `GET /v1/keys`.
4. **Simulation.** `/v1/simulate/action` runs the decide path with the effect
   suppressed; `/v1/simulate/policy` replays recorded traffic against a
   candidate bundle and reports the diff.
5. **Versioned protocol.** Everything under `/v1`; `GET /v1/openapi.json` serves
   the committed contract.

Two policy engines sit behind one provider interface - Cedar and OPA, both
embedded as WASM - and a parity suite proves they decide the shared intent
identically. Reconciliation and arbitration are DRP-layer functions the gateway
also provides; they are kept in separable modules and are not part of protocol
conformance.

## Conformance levels

From the protocol semantics (`spec/drp-protocol-semantics-v0.1.md`, section 8),
a runtime claims one of two levels:

- **Enact-conformant** - implements `/decide`, `/policy`, `/escalations`,
  `/receipts`, `/keys` and `/openapi.json` with the decision and receipt
  semantics. This is roughly where the best current products are.
- **Readback-conformant** - enact-conformant PLUS `/policy/effective`,
  `/decisions`, `/state/{decisionId}` and the simulate endpoints. This is the
  level the essays argue does not yet exist commercially.

This gateway is **readback-conformant**. Its conformance tests validate live
handler responses against the committed YAML: the specification is the input,
never generated from the handlers (the spec-first rule).

## Documented limitations

The build implements real versions of the buildable rungs. For the rest it
implements the *limit* - an explicit refusal or an after-the-fact flag - and
tests it (Suite L, release-blocking):

- Cross-framework arbitration is rejected with the message
  `cross-framework arbitration not supported`, not approximated.
- Async provenance laundering is allowed inline; it is flagged only after the
  fact, in reconciliation.
- An action anomalous only relative to another principal's baseline is not
  denied inline; the decision carries `limitations: ['cross-principal-baseline']`.
- The gateway gates the declared action, not a tool's internal behaviour, and
  every decision says so with `gatedOn: "declared-action"`.
- Device principals report `principalCoverage: "partial"` - a documented
  gradient, not a fifth equal principal type.
- No latency or throughput number appears in this repo without a reproducible
  benchmark script under `scripts/bench/`.

Where building the gateway showed the committed spec was incomplete or in
tension with the test plan, the difference is recorded in
`spec/DIVERGENCES.md` rather than resolved by editing `spec/`.

## Layout

```
spec/        committed protocol (input, not generated) + DIVERGENCES.md
src/         the gateway: single decide path, providers, proxy, state, ...
fixtures/    policy.cedar, policy.rego, policy.wasm, manifest, principals
test/        suites A-M plus support/ harness, and conformance/
scripts/     build-rego.sh and bench/ (any reported number lives here)
```

## Running the suite

```
npm install
npm run build:rego   # rebuild fixtures/policy.wasm from fixtures/policy.rego (needs the opa CLI)
npm run typecheck
npm test             # or: npx vitest run
```

Runtime: Node 22+, TypeScript, ESM; tests run on Vitest. Suites A-M cover
enactment and the escalation lifecycle, the provider abstraction over Cedar and
OPA, signed and chained receipts, readback, simulation, reconciliation,
arbitration, cross-principal identity, context carriage, the three demo
scenarios, the served contract, the honesty acceptance group, and protocol
conformance.

## Governing the tool that built it

A Claude Code `PreToolUse` hook adapter under `scripts/claude-code-hook/` routes
every tool call through the gateway's `/v1/decide`, so the gateway can govern
Claude Code itself. The adapter (`adapter.mjs`) reads the hook JSON on stdin,
POSTs a proposal to a running gateway, and maps a `deny` decision to the hook's
`permissionDecision: "deny"` (an `escalate` maps to `"ask"`; an `allow` defers
to the normal permission flow), per the Claude Code hooks reference at
https://code.claude.com/docs/en/hooks.

Start a gateway, then wire the adapter into `.claude/settings.json`:

```
npm run serve:gateway   # http://127.0.0.1:8787
```

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/scripts/claude-code-hook/adapter.mjs"
          }
        ]
      }
    ]
  }
}
```

See `scripts/claude-code-hook/README.md` for the configuration environment
variables and the decision mapping. This is a stretch beyond the conformance
suite; an integration test (`test/stretch-hook-adapter.test.ts`) proves a denied
tool is blocked through the adapter.
