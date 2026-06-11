/**
 * MCP proxy: the gateway presents as an MCP server to the agent harness and
 * acts as an MCP client to one or more downstream servers. Every tools/call it
 * receives is converted to an ActionProposal and put through the SAME decide
 * pipeline as HTTP /v1/decide. allow forwards downstream and returns the
 * result; deny and escalate return a tool error and the call never reaches
 * downstream (build brief sections 2 and 4).
 *
 * M1 wires the proxy's decision routing in-process against the shared pipeline;
 * the stdio / streamable-HTTP transport is added when a suite exercises it.
 */

import type { ActionProposal } from '../types';
import type { EnactedDecision } from '../pipeline/decide';

export interface McpProxyClient {
  callTool(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface McpProxyDeps {
  /** The identity proxied tool calls are attributed to. */
  identity: { principal: string; identitySource?: 'native' | 'delegated' };
  /** The shared decide-and-enact path (HTTP /v1/decide uses the same one). */
  decideAndEnact: (proposal: ActionProposal) => Promise<EnactedDecision>;
}

/** Map a tool name to its declared action and resource shape. */
const ACTION_BY_TOOL: Record<string, string> = {
  read_file: 'read',
  write_file: 'write',
  delete_file: 'delete',
  http_fetch: 'egress',
};

export function proposalFromToolCall(
  tool: string,
  args: Record<string, unknown>,
  principal: string,
  identitySource: 'native' | 'delegated' = 'native',
): ActionProposal {
  const declaredAction = ACTION_BY_TOOL[tool] ?? tool;
  const resource =
    declaredAction === 'egress'
      ? { kind: 'egress', id: String(args.domain ?? '') }
      : { kind: 'file', id: String(args.path ?? args.id ?? 'n/a') };
  return { principal, identitySource, tool, args, resource, declaredAction };
}

export function createMcpProxy(deps: McpProxyDeps): McpProxyClient {
  return {
    async callTool(tool, args) {
      const proposal = proposalFromToolCall(
        tool,
        args,
        deps.identity.principal,
        deps.identity.identitySource,
      );
      const { decision, downstreamResult } = await deps.decideAndEnact(proposal);
      if (decision.decision === 'deny') {
        throw new Error(`tool call denied: ${decision.reason}`);
      }
      if (decision.decision === 'escalate') {
        throw new Error(`tool call held for escalation - escalate to resolve: ${decision.reason}`);
      }
      return downstreamResult;
    },
  };
}
