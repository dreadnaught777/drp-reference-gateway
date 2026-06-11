/**
 * Fastify wiring and the /v1 routes (the five interfaces plus policy loading,
 * escalation resolution, conflicts, keys, and the OpenAPI document). HTTP
 * /v1/decide and the MCP proxy share one decide pipeline.
 *
 * Default-deny is not configurable. createGateway with any default-allow
 * option must throw (CLAUDE.md engineering rules; test harness section 0).
 *
 * M0 scaffold: signatures only. Routes wired from M1 onward.
 */

export interface GatewayServerOptions {
  provider: 'cedar' | 'opa';
}

export function buildServer(_opts: GatewayServerOptions): never {
  throw new Error('Fastify server not implemented until M1');
}
