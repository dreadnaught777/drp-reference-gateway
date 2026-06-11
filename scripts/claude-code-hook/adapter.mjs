#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook adapter for the DRP reference gateway.
 *
 * Reads the PreToolUse hook JSON on stdin, converts the tool call to a DRP
 * ActionProposal, POSTs it to a running gateway's /v1/decide, and maps the
 * decision to the hook's permission output (per the Claude Code hooks
 * reference: https://code.claude.com/docs/en/hooks):
 *   deny     -> permissionDecision "deny"  (the tool call is blocked)
 *   escalate -> permissionDecision "ask"   (user is prompted)
 *   allow    -> no decision (exit 0); the normal permission flow applies
 *
 * This lets the gateway govern the very tool that built it.
 *
 * Configuration (environment):
 *   DRP_GATEWAY_URL   base URL of the running gateway (default http://127.0.0.1:8787)
 *   DRP_PRINCIPAL     SPIFFE id attributed to the agent (default spiffe://demo/agent/claude-code)
 *   DRP_FAIL_CLOSED   if "1", a gateway error denies the call; default is fail-open (defer)
 */

const GATEWAY_URL = (process.env.DRP_GATEWAY_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const PRINCIPAL = process.env.DRP_PRINCIPAL ?? 'spiffe://demo/agent/claude-code';
const FAIL_CLOSED = process.env.DRP_FAIL_CLOSED === '1';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    // No stdin (e.g. run by hand): resolve empty after the stream closes.
    if (process.stdin.isTTY) resolve(data);
  });
}

function emit(output) {
  process.stdout.write(JSON.stringify(output));
}

function deny(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function ask(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  });
}

/** Map a Claude Code tool call to a DRP ActionProposal. */
function toProposal(toolName, toolInput) {
  const args = toolInput && typeof toolInput === 'object' ? toolInput : {};
  switch (toolName) {
    case 'Read':
    case 'Glob':
    case 'Grep':
      return {
        principal: PRINCIPAL,
        tool: toolName,
        declaredAction: 'read',
        resource: { kind: 'file', id: String(args.file_path ?? args.path ?? args.pattern ?? '') },
        args,
      };
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return {
        principal: PRINCIPAL,
        tool: toolName,
        declaredAction: 'write',
        resource: { kind: 'file', id: String(args.file_path ?? args.notebook_path ?? '') },
        args,
      };
    case 'Bash':
      return {
        principal: PRINCIPAL,
        tool: toolName,
        declaredAction: 'execute',
        resource: { kind: 'command', id: String(args.command ?? '') },
        args,
      };
    case 'WebFetch':
    case 'WebSearch': {
      let domain = '';
      try {
        domain = args.url ? new URL(String(args.url)).hostname : '';
      } catch {
        domain = '';
      }
      return {
        principal: PRINCIPAL,
        tool: toolName,
        declaredAction: 'egress',
        resource: { kind: 'egress', id: domain },
        args: { ...args, domain },
      };
    }
    default:
      return {
        principal: PRINCIPAL,
        tool: toolName,
        declaredAction: String(toolName).toLowerCase(),
        resource: { kind: 'tool', id: String(toolName) },
        args,
      };
  }
}

async function main() {
  const raw = await readStdin();
  let hook;
  try {
    hook = JSON.parse(raw || '{}');
  } catch {
    // Malformed hook input: do not block the session on our own bug.
    process.exit(0);
  }

  const toolName = hook.tool_name ?? 'unknown';
  const proposal = toProposal(toolName, hook.tool_input);

  let decision;
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(proposal),
    });
    if (!res.ok) throw new Error(`gateway returned HTTP ${res.status}`);
    decision = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (FAIL_CLOSED) {
      deny(`DRP gateway unreachable (${message}); failing closed`);
      process.exit(0);
    }
    // Fail-open: defer to the normal permission flow, with a warning.
    emit({ systemMessage: `DRP gateway unreachable (${message}); deferring to normal permissions` });
    process.exit(0);
  }

  if (decision.decision === 'deny') {
    deny(decision.reason ?? 'denied by DRP policy');
  } else if (decision.decision === 'escalate') {
    ask(decision.reason ?? 'escalated by DRP policy');
  }
  // allow: no output; the normal permission flow applies.
  process.exit(0);
}

void main();
