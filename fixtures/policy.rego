# Shared DRP demo intent, Rego encoding. The same intent is encoded in
# fixtures/policy.cedar; the parity suite (B) proves both engines agree.
#
# Entrypoint drp/decision returns { effect, rule, reason } directly. Compile to
# the WASM bundle the OPA provider loads with:
#   opa build -t wasm -e drp/decision   (see scripts/build-rego.sh)
#
# The provider passes the engine input straight through, so the policy reads
# input.declaredAction, input.resource.{id,kind}, input.args.{domain,payload}
# and input.priorContext.

package drp

# default-deny: absence of a matching rule produces deny.
default decision := {
	"effect": "deny",
	"rule": null,
	"reason": "default-deny: no rule matched",
}

# read-path in sandbox -> allow
decision := {
	"effect": "allow",
	"rule": "sandbox-read-allow",
	"reason": "read-path in sandbox",
} if {
	input.declaredAction == "read"
	startswith(input.resource.id, "sandbox/")
}

# read CRM data -> allow (innocuous alone; scenario-2 enabler)
decision := {
	"effect": "allow",
	"rule": "crm-read-allow",
	"reason": "read CRM data",
} if {
	input.declaredAction == "read"
	input.resource.kind == "crm"
}

# read an artefact -> allow
decision := {
	"effect": "allow",
	"rule": "artefact-read-allow",
	"reason": "read an artefact",
} if {
	input.declaredAction == "read"
	input.resource.kind == "artefact"
}

# write/delete (non-artefact) -> escalate
decision := {
	"effect": "escalate",
	"rule": "write-escalate",
	"reason": "write/delete escalates",
} if {
	input.declaredAction in {"write", "delete"}
	input.resource.kind != "artefact"
}

# write an artefact -> allow (scenario 3: allowed inline)
decision := {
	"effect": "allow",
	"rule": "artefact-write-allow",
	"reason": "write an artefact",
} if {
	input.declaredAction in {"write", "delete"}
	input.resource.kind == "artefact"
}

# send carrying a trusted prior read -> deny (composite; scenario 2)
decision := {
	"effect": "deny",
	"rule": "composite-deny",
	"reason": "cross-principal composite: prior read carried to an external send",
} if {
	input.declaredAction == "send"
	has_prior_read
}

# remote-contacting send (base) -> escalate
decision := {
	"effect": "escalate",
	"rule": "send-escalate",
	"reason": "remote-contacting send escalates",
} if {
	input.declaredAction == "send"
	not has_prior_read
}

# egress carrying a data payload -> deny (capability, not destination; scenario 1)
decision := {
	"effect": "deny",
	"rule": "egress-capability-deny",
	"reason": "egress grant binds to capability, not a destination filter",
} if {
	input.declaredAction == "egress"
	has_payload
}

# one permitted egress domain, capability-bound, no payload -> allow
decision := {
	"effect": "allow",
	"rule": "egress-allowlist",
	"reason": "one permitted egress domain, capability-bound",
} if {
	input.declaredAction == "egress"
	input.args.domain == "api.allowed.example"
	not has_payload
}

has_payload if {
	input.args.payload
	input.args.payload != ""
}

has_prior_read if {
	input.priorContext.action == "read"
}
