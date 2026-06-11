/**
 * Downstream MCP servers, as seen by the proxy's client side. The pipeline
 * forwards an allowed action to the server that handles the tool; deny and
 * escalate never reach here. In tests these are the recording stub servers; in
 * production they would be real MCP clients over a transport.
 */

export interface Downstream {
  readonly name: string;
  handles(tool: string): boolean;
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

export function routeTool(downstreams: Downstream[], tool: string): Downstream | undefined {
  return downstreams.find((d) => d.handles(tool));
}
