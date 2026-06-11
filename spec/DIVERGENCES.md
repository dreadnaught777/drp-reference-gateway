# Spec divergences

Build findings feeding a v0.2 of the protocol specification.

The protocol spec in `spec/` is an INPUT to this build, not an output of it.
The gateway implements the committed spec; conformance tests validate the live
handlers against the committed YAML. Where implementation reveals the spec is
wrong, incomplete, or in tension with the test plan, the divergence is recorded
HERE rather than quietly bending either side. The files in `spec/` are never
edited to make an implementation fit.

Precedence on observable behaviour (CLAUDE.md): test plan first, protocol spec
second, build brief third. Where they disagree: STOP, record below, and ask.

A behavioural difference between spec and implementation without an entry here
is a release-blocking defect (Suite M).

## Findings

_None recorded._
