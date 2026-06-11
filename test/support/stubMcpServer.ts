/**
 * A downstream MCP stub server that records every tool call it actually
 * receives, so tests can assert a call did or did not reach it (test plan
 * section 0). Two are used: `files` (read/write/delete) and `egress` (an
 * HTTP-fetch tool standing in for the allow-listed destination).
 *
 * M0 scaffold: an in-memory recorder with deterministic tool stubs. The real
 * MCP server/client transport is wired into the proxy at M1; the recording
 * surface (`received`) is the contract the suites assert against and is stable
 * from here.
 */

export interface RecordedCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface StubMcpServer {
  readonly name: string;
  /** Every tool call this server actually received, in order. */
  readonly received: RecordedCall[];
  /** The tool names this server exposes downstream. */
  readonly tools: string[];
  /** Invoke a tool as the proxy would once a decision allows it. */
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
  reset(): void;
}

const TOOLSETS: Record<string, string[]> = {
  files: ['read_file', 'write_file', 'delete_file'],
  egress: ['http_fetch'],
};

export function stubMcpServer(name: string): StubMcpServer {
  const received: RecordedCall[] = [];
  const tools = TOOLSETS[name] ?? [];

  return {
    name,
    received,
    tools,
    async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
      received.push({ tool, args });
      // Deterministic downstream result so allow-path tests can assert a
      // response surfaces to the caller.
      return { ok: true, tool, server: name, args };
    },
    reset(): void {
      received.length = 0;
    },
  };
}
