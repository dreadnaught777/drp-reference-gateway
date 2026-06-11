// Shared DRP demo intent, Cedar encoding. Same intent as fixtures/policy.rego:
//   read-path allowed in sandbox; write/delete and remote-contacting calls
//   escalate; one egress allow-list entry, capability-bound; default-deny.
//
// Cedar has no third effect. Effects beyond allow (escalate) are tagged by the
// policy @id and resolved to an effect via fixtures/drp.manifest.json - the
// adapter identifies the matched policy and maps its rule id to the effect.

// read-path in sandbox -> allow
@id("sandbox-read-allow")
permit (
  principal,
  action == Action::"read",
  resource
)
when { resource.path like "sandbox/*" };

// write/delete -> escalate (tagged; manifest maps write-escalate to escalate)
@id("write-escalate")
permit (
  principal,
  action in [Action::"write", Action::"delete"],
  resource
);

// one permitted egress domain, capability-bound -> allow. The grant binds to
// capability, not destination: an allow-listed domain used to carry protected
// data out is denied elsewhere (demo scenario 1), not permitted here.
@id("egress-allowlist")
permit (
  principal,
  action == Action::"egress",
  resource
)
when { resource.domain == "api.allowed.example" };
