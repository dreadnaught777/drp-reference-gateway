# DRP Runtime Protocol - semantics and conformance, v0.1

Companion to `drp-runtime-protocol-v0.1.yaml`. The YAML defines shapes; this
document defines behaviour. Both together are the specification. Normative
keywords per RFC 2119.

## 0. Naming - open decision

"DRP Runtime Protocol" is a placeholder. Options, with the trade each makes:

1. **DRP Runtime Protocol** - ties the protocol to the coined framework;
   strongest claim to the lane; weakest as a neutral-body candidate, because
   it arrives pre-branded.
2. **Decide and Readback Protocol** - matches the essays' rhetorical hook and
   says what it does; the acronym is forgettable, which may be a feature.
3. A neutral name chosen later by whichever body adopts it - the essays' own
   Interface 5 logic argues the name should not belong to one author forever.

Recommendation: 1 for v0.x while the artefact is yours; expect to surrender
the name if it moves to a neutral home, and say so in the essay. That
concession is itself evidence of good faith.

## 1. Scope and the protocol/layer split

This protocol specifies what a RUNTIME exposes. The following are
deliberately NOT part of it, because they are functions of the policy layer
that consumes it:

- Reconciliation (drift detection over receipts and readback)
- Cross-source arbitration and conflict records
- Provider compilation from framework vocabularies

A conforming runtime knows nothing about those. A DRP layer implements them
by calling this protocol. The reference gateway implements both sides and
MUST keep them in separable modules so the split stays demonstrable.

## 2. Decision semantics

- **Default-deny.** No matching rule MUST yield `deny`. A runtime MUST NOT
  expose a configuration that flips the default to allow.
- **Order.** The decision MUST be rendered before the action executes. For
  `allow`, execution follows; for `deny`, the action MUST NOT execute; for
  `escalate`, the action MUST be held unexecuted until resolved, and an
  unresolved escalation MUST NOT execute on timeout.
- **Deny is not an error.** HTTP 200 carries all three effects. Transport
  errors are reserved for malformed proposals and unknown identifiers.
- **gatedOn.** The runtime gates the declared, typed action. It does not
  warrant that a tool's internal behaviour matches its declaration. Every
  decision response says so (`gatedOn: "declared-action"`). Implementations
  MUST NOT claim semantic verification of tool internals.
- **Untrusted proposer.** The model (or any proposer) is untrusted. A
  declaration is input to verification, never a substitute for it.

## 3. Readback semantics

- A decision made via `/decide` MUST be retrievable via `/decisions` and
  `/state/{decisionId}` immediately after the response is sent (read-your-
  writes within one runtime).
- `/state/{decisionId}` MUST return the policy version actually evaluated,
  not the version current at query time.
- `/policy/effective` MUST change its `version` whenever the active bundle
  changes, and MUST reflect only the active bundle (never a candidate under
  simulation).
- Readback is observation only. No endpoint in this protocol mutates policy
  or decisions except `/policy` (load) and `/escalations/{id}` (resolve),
  and both produce receipts.

## 4. Receipts and the chain

- Canonicalisation: RFC 8785 (JCS). Hash: SHA-256. Signature: Ed25519,
  detached (the signature is not a field of the signed body).
- Chain: `prevHash` is the SHA-256 of the prior receipt's canonical form;
  the first receipt carries the literal `"genesis"`. A verifier holding the
  published key and the sequence MUST be able to verify both integrity and
  order offline, with no call back to the runtime.
- Simulated decisions produce receipts marked `simulated: true` and
  participate in the chain (so the record of what was asked is itself
  tamper-evident).
- Key rotation: retired keys remain at `/keys` so old receipts stay
  verifiable.

## 5. Context carriage

- A `contextToken` MUST only be admitted to policy input after signature
  verification against `/keys`. A token that fails verification MUST be
  excluded from policy input and the decision MUST report
  `contextTrusted: false`.
- Verification failure MUST NOT by itself deny the action; policy decides
  what absence of trusted context means. (A policy MAY require trusted
  context for specific actions, which is how the composite-chain scenario
  is expressed.)
- v0.1 defines carriage within one runtime's trust domain only. Cross-
  domain, cross-engine carriage is named as out of scope; this is the
  unsolved residue the essays identify, and the spec MUST NOT imply
  otherwise.

## 6. Policy acceptance and simulation

- `/policy` validation MUST reject a bundle containing a detectable
  contradiction. v0.1 requires only static validation plus probe-based
  contradiction checking; it does not require formal analysis, and
  implementations MUST NOT describe probe checking as automated reasoning.
- Vocabulary: a bundle declares one `vocabulary`. A `/decide` request naming
  sources of differing vocabularies MUST be rejected with an error whose
  message contains "cross-framework arbitration not supported". (The
  arbitration of same-vocabulary sources is layer behaviour and out of
  protocol scope; the rejection rule sits here because the runtime is where
  the mixed request arrives.)
- `/simulate/action` MUST traverse the identical evaluation path as
  `/decide` with effect suppressed. A divergence between simulated and real
  decisions for the same input and policy version is a conformance failure.
- `/simulate/policy` in v0.1 is defined over recorded traffic only and MUST
  say so (`trafficSource: "recorded"`).

## 7. Versioning

- Wire prefix `/v1` changes only on incompatible change.
- This document and the YAML carry semver together. Within 0.x, anything
  may change; from 1.0, additive only within the major.
- Vendor extensions: `x-drp-` prefixed fields are permitted anywhere and
  MUST be ignorable.

## 8. Conformance

A runtime claims conformance at one of two levels:

- **Enact-conformant**: implements `/decide`, `/policy`, `/escalations`,
  `/receipts`, `/keys`, `/openapi.json` with the semantics above. This is
  roughly where the best current products are.
- **Readback-conformant**: enact-conformant PLUS `/policy/effective`,
  `/decisions`, `/state/{decisionId}`, and the simulate endpoints. This is
  the level the essays argue does not yet exist commercially.

The two-level structure is deliberate: it lets the essays say precisely
what existing products have and what is missing, in the protocol's own
vocabulary, and it gives a vendor a defined increment to ship.

The reference gateway MUST be readback-conformant, and its conformance
tests MUST validate live handler behaviour against the committed YAML
(spec as input), not generate the YAML from the handlers (spec as output).
