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

### D1 - SignedReceipt is nested in the spec, flat in the test plan and brief

- **Where:** `spec/drp-runtime-protocol-v0.1.yaml` `components.schemas.SignedReceipt`
  (and `GET /receipts/{ref}`) vs `docs/drp-reference-gateway-tests-v2.md` Suite C
  and `docs/drp-reference-gateway-build-brief.md` section 8.
- **Discrepancy:** the spec models a receipt as
  `SignedReceipt = { receipt: Receipt, sig, keyId }` - the signed body nested
  under a `receipt` key, with `sig`/`keyId` as siblings. The test plan treats
  the receipt as a flat object: Suite C reads `a.receipt.prevHash` and
  `a.receipt.decision`, tampers via `{ ...a.receipt, decision: 'allow' }`, and
  calls `verifyReceipt(receipt, key)` where the helper strips `sig`/`keyId` and
  canonicalises the remaining top-level fields. The build brief section 8 agrees
  with the flat shape ("carried alongside as `{ sig, keyId }`... the signature
  is not inside the signed body"). The nested shape would break Suite C's
  offline verification (the helper would canonicalise `{ receipt: ... }`, not
  the signed body).
- **Resolution:** built to the test plan and brief (flat receipt: body fields
  plus detached `sig`/`keyId`), per the precedence rule (test plan first). The
  committed YAML is left unchanged. For a v0.2 of the spec, `SignedReceipt`
  should be flattened to match, or the helper and brief reconciled the other
  way - a decision the spec owner should make.

### D2 - Published key encoding: PEM vs base64 SPKI

- **Where:** `spec/drp-runtime-protocol-v0.1.yaml` `GET /keys`
  (`publicKey: base64 SPKI`) vs the offline verifier `test/support/verifyReceipt`.
- **Discrepancy:** the spec describes `publicKey` as "base64 SPKI". The test
  helper consumes the published key directly
  (`verifyReceipt(receipt, active.publicKey)`) via `crypto.createPublicKey`,
  which parses PEM. A bare base64 SPKI string would not verify without an
  explicit `{ format: 'der', type: 'spki' }` wrapper the helper does not apply.
- **Resolution:** `/keys` publishes the key as PEM (SPKI), which the helper and
  any offline verifier holding the PEM can use directly, per the test plan's
  use of the published key. Recorded for v0.2: either widen the spec wording to
  PEM, or have verifiers decode base64 SPKI explicitly.
