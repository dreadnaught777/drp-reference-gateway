# Shared DRP demo intent, Rego encoding. Same intent as fixtures/policy.cedar:
#   read-path allowed in sandbox; write/delete and remote-contacting calls
#   escalate; one egress allow-list entry, capability-bound; default-deny.
#
# Entrypoint drp/decision returns { effect, rule, reason } directly.
# Compile to the WASM bundle the OPA provider loads with:
#   opa build -t wasm -e drp/decision   (see scripts/build-rego.sh)

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

# write/delete -> escalate
decision := {
	"effect": "escalate",
	"rule": "write-escalate",
	"reason": "write/delete escalates",
} if {
	input.declaredAction in {"write", "delete"}
}

# one permitted egress domain, capability-bound -> allow
decision := {
	"effect": "allow",
	"rule": "egress-allowlist",
	"reason": "one permitted egress domain, capability-bound",
} if {
	input.declaredAction == "egress"
	input.args.domain == "api.allowed.example"
}
