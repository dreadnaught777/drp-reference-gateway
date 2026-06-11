# Self-governing hook adapter

A Claude Code `PreToolUse` hook adapter that routes every tool call through this
gateway's `/v1/decide`, so the gateway can govern the tool that built it. It
follows the Claude Code hooks reference:
https://code.claude.com/docs/en/hooks

## How it works

`adapter.mjs` reads the `PreToolUse` hook JSON on stdin, converts the tool call
to a DRP ActionProposal, POSTs it to a running gateway's `/v1/decide`, and maps
the decision to the hook's permission output:

| DRP decision | Hook output |
|---|---|
| `deny` | `permissionDecision: "deny"` - the tool call is blocked, the reason shown to Claude |
| `escalate` | `permissionDecision: "ask"` - the user is prompted |
| `allow` | no decision (exit 0); the normal permission flow applies |

If the gateway is unreachable the adapter fails open (defers to normal
permissions) by default, or fails closed (denies) when `DRP_FAIL_CLOSED=1`.

## Configuration (environment)

- `DRP_GATEWAY_URL` - base URL of the running gateway (default `http://127.0.0.1:8787`)
- `DRP_PRINCIPAL` - SPIFFE id attributed to the agent (default `spiffe://demo/agent/claude-code`)
- `DRP_FAIL_CLOSED` - set to `1` to deny on a gateway error instead of deferring

## Running the gateway

```
npm run serve:gateway          # starts on http://127.0.0.1:8787 (DRP_PORT to change)
```

## Wiring it into .claude/settings.json

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

Use an absolute path to `adapter.mjs`. Set `DRP_GATEWAY_URL` in the environment
if the gateway is not on the default port. With the demo policy, a sandbox
`Read` is allowed while a `Bash` command is denied (no rule grants execution).
