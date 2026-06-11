/**
 * Start a standalone DRP gateway for the PreToolUse hook adapter to call.
 * Run with: npx tsx scripts/claude-code-hook/serve.ts   (or: npm run serve:gateway)
 *
 * Environment:
 *   DRP_PORT   port to listen on (default 8787)
 */

import { startGatewayServer } from '../../src/httpServer';
import { defaultCedarBundle } from '../../src/fixtures';

const port = Number(process.env.DRP_PORT ?? 8787);

const running = await startGatewayServer(
  { provider: 'cedar', policy: defaultCedarBundle(), downstreams: [] },
  { port },
);

// eslint-disable-next-line no-console
console.log(`DRP gateway listening on ${running.url} (POST ${running.url}/v1/decide)`);
