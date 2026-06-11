/**
 * Integration test for the self-governing hook stretch: a Claude Code
 * PreToolUse tool call is routed through scripts/claude-code-hook/adapter.mjs to
 * a running gateway, and a denied tool is blocked.
 *
 * Not a transcribed plan suite - an authored integration test for the stretch.
 * It boots the real HTTP gateway and runs the adapter as a subprocess, so it
 * exercises the full path: hook JSON -> adapter -> POST /v1/decide -> hook output.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startGatewayServer, type RunningServer } from '../src/httpServer';
import { defaultCedarBundle } from '../src/fixtures';

const adapterPath = fileURLToPath(new URL('../scripts/claude-code-hook/adapter.mjs', import.meta.url));

interface AdapterRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runAdapter(hookInput: unknown, env: Record<string, string>): Promise<AdapterRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [adapterPath], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(JSON.stringify(hookInput));
    child.stdin.end();
  });
}

let server: RunningServer;

beforeAll(async () => {
  server = await startGatewayServer({
    provider: 'cedar',
    policy: defaultCedarBundle(),
    downstreams: [],
  });
});

afterAll(async () => {
  await server.close();
});

describe('claude code self-governing hook adapter', () => {
  it('blocks a denied tool (Bash) through the adapter', async () => {
    const hook = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/build' },
    };
    const { code, stdout } = await runAdapter(hook, { DRP_GATEWAY_URL: server.url });
    expect(code).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/.+/);
  });

  it('does not block an allowed tool (sandbox Read)', async () => {
    const hook = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: 'sandbox/notes.txt' },
    };
    const { code, stdout } = await runAdapter(hook, { DRP_GATEWAY_URL: server.url });
    expect(code).toBe(0);
    expect(stdout).not.toMatch(/"permissionDecision":\s*"deny"/);
  });

  it('fails closed when the gateway is unreachable and DRP_FAIL_CLOSED=1', async () => {
    const hook = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: 'sandbox/notes.txt' },
    };
    const { code, stdout } = await runAdapter(hook, {
      DRP_GATEWAY_URL: 'http://127.0.0.1:1', // nothing listening
      DRP_FAIL_CLOSED: '1',
    });
    expect(code).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });
});
