/**
 * MCP proxy: the gateway presents as an MCP server to the agent harness and
 * acts as an MCP client to one or more downstream servers. Every tools/call it
 * receives is converted to an ActionProposal and put through the decide
 * pipeline. allow forwards downstream and returns the result; deny and
 * escalate return a tool error and the call never reaches downstream.
 *
 * M0 scaffold: signature only. Gate: Suite A (M1).
 */

export interface McpProxyClient {
  callTool(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

export function createMcpProxy(): McpProxyClient {
  return {
    async callTool(_tool: string, _args: Record<string, unknown>): Promise<unknown> {
      throw new Error('MCP proxy not implemented until M1');
    },
  };
}
