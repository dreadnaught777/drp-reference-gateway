# drp-reference-gateway - standing rules

## Documents and precedence
Authoritative documents, in order of precedence on observable behaviour:
1. docs/drp-reference-gateway-tests-v2.md   (the test plan)
2. spec/drp-runtime-protocol-v0.1.yaml + spec/drp-protocol-semantics-v0.1.md
3. docs/drp-reference-gateway-build-brief.md
Where they disagree: STOP, record the discrepancy in spec/DIVERGENCES.md,
and ask. Never resolve a conflict silently in any direction.

## Spec-first
The protocol spec is an INPUT. The gateway implements it; conformance tests
validate handlers against the committed YAML. Never regenerate or edit the
files in spec/ to make an implementation fit. If implementation shows the
spec is wrong, record it in spec/DIVERGENCES.md and continue building to
the spec as committed.

## Tests are transcribed, then frozen
Test suites are transcribed verbatim from the test plan into test/, suite
by suite, at the milestone that gates on them. After transcription, test
files are immutable: making a failing test pass by editing the test is a
release-blocking defect. If a test in the plan is itself defective
(impossible assertion, typo), STOP, record in spec/DIVERGENCES.md, ask.

## Honesty rules (Section 5 of the brief; Suite L)
The LIMITATION tests assert what the gateway correctly does NOT do. They
must pass by implementing the limit, never by implementing the capability:
- async provenance laundering decides allow inline, flagged only in reconcile
- cross-framework arbitration is rejected with the exact error message
- cross-principal-baseline anomalies are not denied; limitations[] says so
- gatedOn is always "declared-action"; no claim of tool-internal verification
- probe-based contradiction checking is never described as automated reasoning
- device principals report principalCoverage "partial"
If a limitation test starts passing for the wrong reason, treat it as a
defect and investigate.

## Engineering rules
- Single decide path: HTTP /v1/decide and the MCP proxy share one pipeline.
- Default-deny is not configurable. createGateway with any default-allow
  option must throw.
- reconcile/ and arbitrate/ are DRP-layer modules, not protocol: they stay
  out of spec/, separable from the protocol surface.
- Receipts: RFC 8785 JCS, SHA-256, Ed25519 detached, prevHash chain,
  literal "genesis" first. Simulated receipts are chain links.
- No performance numbers anywhere (README, comments, commit messages)
  without a script in scripts/bench/ that reproduces them.
- Commit at every milestone gate with message "M<n>: <suites> green".

## Style for user-facing text (README, errors, docs)
UK English. No em-dashes - use " - ". Do not use the words: 
load-bearing, signal, sharp.