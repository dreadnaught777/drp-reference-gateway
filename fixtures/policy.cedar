// Shared DRP demo intent, Cedar encoding. The same intent is encoded in
// fixtures/policy.rego; the parity suite (B) proves both engines agree.
//
// Cedar has no third effect. Effects beyond allow (escalate) are tagged by the
// policy @id and resolved via fixtures/drp.manifest.json - the adapter maps the
// determining policy id to the manifest effect, and uses the manifest summary
// as the decision reason.
//
// Two request-context flags are always supplied by the adapter:
//   context.priorRead     - a trusted prior decision for a read was carried in
//   context.payloadPresent - the call carries a data payload

// read-path in sandbox -> allow
@id("sandbox-read-allow")
permit (
  principal,
  action == Action::"read",
  resource
)
when { resource.path like "sandbox/*" };

// read CRM data -> allow. Innocuous alone; the scenario-2 enabler.
@id("crm-read-allow")
permit (
  principal,
  action == Action::"read",
  resource
)
when { resource.kind == "crm" };

// read an artefact -> allow.
@id("artefact-read-allow")
permit (
  principal,
  action == Action::"read",
  resource
)
when { resource.kind == "artefact" };

// write/delete (non-artefact) -> escalate.
@id("write-escalate")
permit (
  principal,
  action in [Action::"write", Action::"delete"],
  resource
)
when { resource.kind != "artefact" };

// write an artefact -> allow. Scenario 3: allowed inline; the cross-principal
// laundering is caught only after the fact, in reconciliation.
@id("artefact-write-allow")
permit (
  principal,
  action in [Action::"write", Action::"delete"],
  resource
)
when { resource.kind == "artefact" };

// remote-contacting send -> escalate (base, when no trusted prior read).
@id("send-escalate")
permit (
  principal,
  action == Action::"send",
  resource
);

// composite: a send carrying a trusted prior read is denied. Neither call is
// anomalous alone; the carried context is what catches it (scenario 2).
@id("composite-deny")
forbid (
  principal,
  action == Action::"send",
  resource
)
when { context.priorRead };

// one permitted egress domain, capability-bound -> allow.
@id("egress-allowlist")
permit (
  principal,
  action == Action::"egress",
  resource
)
when { resource.domain == "api.allowed.example" };

// egress carrying a data payload -> deny: the grant binds to a capability, not
// a destination filter, so the permitted domain cannot be used to carry data
// out (scenario 1).
@id("egress-capability-deny")
forbid (
  principal,
  action == Action::"egress",
  resource
)
when { context.payloadPresent };
