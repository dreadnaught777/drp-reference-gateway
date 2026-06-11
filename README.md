# drp-reference-gateway

A reference implementation of Declarative Runtime Policy (DRP) at the smallest
honest scope: an MCP-proxying policy gateway that demonstrates the five runtime
interfaces the essay series argues for, including the one no commercial runtime
ships - decision readback.

This gateway is one enforcement point implementing the DRP layer's contract,
not the layer itself. It exists to prove the interfaces are buildable and to
give the essays a running artefact, not to be deployed in production.

## Status

Scaffold (M0). The protocol spec is committed under `spec/`, fixtures and the
test harness are in place, and the build proceeds milestone by milestone, each
gated on named test suites going green. No performance numbers appear anywhere
in this repo without a reproducible benchmark script under `scripts/bench/`.

## Honesty

The build's first principle is honesty: it implements real versions of the
buildable rungs, and for the unbuildable residue it implements the limit - an
explicit, tested refusal or an after-the-fact flag - rather than a fake. The
documented limits include:

- cross-framework arbitration is rejected, not approximated;
- async provenance laundering is allowed inline and flagged only in reconcile;
- cross-principal-baseline anomalies are not denied inline;
- the gateway gates the declared action, not tool-internal behaviour;
- device principals report partial coverage, not a fifth equal principal type.

See `docs/drp-reference-gateway-build-brief.md` section 5 and test Suite L.

## Layout

```
spec/        committed protocol (input, not generated) + DIVERGENCES.md
src/         the gateway: single decide path, providers, proxy, state, ...
fixtures/    policy.cedar, policy.rego, policy.wasm, manifests, principals
test/        suites A-L plus support/ harness, and conformance/
scripts/     build-rego.sh and bench/ (any reported number lives here)
```

## Development

```
npm install
npm run build:rego   # rebuild fixtures/policy.wasm from fixtures/policy.rego
npm run typecheck
npm test
```

Runtime: Node 22+, TypeScript, ESM. Tests run on Vitest.
