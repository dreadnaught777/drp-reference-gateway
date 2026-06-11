/**
 * A minimal standalone HTTP server exposing the decide path over the wire, so a
 * Claude Code PreToolUse hook adapter can POST tool-call proposals to
 * /v1/decide (the self-governing hook stretch). It wraps the same gateway core
 * the rest of the build uses - the decide path stays singular.
 *
 * This is a small node:http server for the demo. The full /v1 control plane
 * (Fastify, src/server.ts) is the production shape; this exposes only what the
 * hook adapter needs: /v1/decide, plus /v1/healthz and /v1/openapi.json.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createGatewayCore, type Gateway, type GatewayConfig } from './gateway';
import type { ActionProposal } from './types';

export interface RunningServer {
  gateway: Gateway;
  server: Server;
  url: string;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function startGatewayServer(
  config: GatewayConfig,
  opts: { port?: number; host?: string } = {},
): Promise<RunningServer> {
  const gateway = createGatewayCore(config);
  const host = opts.host ?? '127.0.0.1';

  const server = createServer((req, res) => {
    void (async () => {
      const url = (req.url ?? '').split('?')[0];

      if (req.method === 'GET' && url === '/v1/healthz') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }
      if (req.method === 'GET' && url === '/v1/openapi.json') {
        sendJson(res, 200, gateway.openapi());
        return;
      }
      if (req.method === 'POST' && url === '/v1/decide') {
        let proposal: ActionProposal;
        try {
          proposal = JSON.parse(await readBody(req)) as ActionProposal;
        } catch {
          sendJson(res, 400, { error: 'bad-request', message: 'request body is not valid JSON' });
          return;
        }
        try {
          // Deny is not a transport error: all effects return HTTP 200.
          const decision = await gateway.decide(proposal);
          sendJson(res, 200, decision);
        } catch (err) {
          sendJson(res, 400, {
            error: 'decide-failed',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      sendJson(res, 404, { error: 'not-found', message: `${req.method} ${url}` });
    })();
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolve({
        gateway,
        server,
        url: `http://${host}:${port}`,
        close: () =>
          new Promise<void>((done, fail) => server.close((e) => (e ? fail(e) : done()))),
      });
    });
  });
}
