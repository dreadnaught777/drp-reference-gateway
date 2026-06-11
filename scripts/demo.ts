/**
 * A dummy "prod" run: drives the gateway through a realistic agent session and
 * prints what happens at each interface. Run with:
 *   npx tsx scripts/demo.ts
 */

import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import canonicalize from 'canonicalize';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { createGatewayCore } from '../src/gateway';
import { defaultCedarBundle } from '../src/fixtures';
import type { Downstream } from '../src/mcp/downstream';
import type { ActionProposal, PolicyBundle, SignedReceipt } from '../src/types';

const trafficUrl = new URL('../fixtures/recordedTraffic.jsonl', import.meta.url);
const log = (...a: unknown[]) => console.log(...a);

function recorder(name: string, tools: string[]): Downstream & { received: unknown[] } {
  const received: unknown[] = [];
  return {
    name,
    received,
    handles: (t) => tools.includes(t),
    async call(tool, args) {
      received.push({ tool, args });
      return { ok: true };
    },
  };
}

/** Offline receipt verification - the same recipe the test helper uses. */
function verifyReceipt(receipt: SignedReceipt, pem: string): boolean {
  const { sig, keyId, ...body } = receipt as SignedReceipt & Record<string, unknown>;
  void keyId;
  const canonical = canonicalize(body);
  if (canonical === undefined) return false;
  const digest = createHash('sha256').update(canonical, 'utf8').digest();
  try {
    return edVerify(null, digest, createPublicKey(pem), Buffer.from(sig as string, 'base64'));
  } catch {
    return false;
  }
}

const exporter = new InMemorySpanExporter();
const tracer = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
}).getTracer('demo');

const files = recorder('files', ['read_file', 'write_file', 'delete_file']);
const egress = recorder('egress', ['http_fetch', 'send_external']);

const recordedTraffic = readFileSync(fileURLToPath(trafficUrl), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const src = (id: string, vocab: string, source: string): PolicyBundle => ({
  bundleVersion: `sha256:${id}`,
  vocabulary: vocab,
  engine: 'cedar',
  source,
  rules: [],
});

const gw = createGatewayCore({
  provider: 'cedar',
  policy: defaultCedarBundle(),
  downstreams: [files, egress],
  tracer,
  recordedTraffic,
  sources: {
    lenient: src('lenient', 'drp-demo-v1', 'permit ( principal, action, resource );\n'),
    strict: src('strict', 'drp-demo-v1', ''),
    foreign: src('foreign', 'foreign-framework-x', ''),
  },
});

const AGENT = 'spiffe://demo/agent/email-helper';
const WORKLOAD = 'spiffe://demo/workload/etl';
const ALICE = 'spiffe://demo/human/alice';

function p(o: Partial<ActionProposal>): ActionProposal {
  return {
    principal: AGENT,
    tool: 'noop',
    args: {},
    resource: { kind: 'unknown', id: 'n/a' },
    declaredAction: 'invoke',
    ...o,
  };
}

async function main() {
  log('# DRP reference gateway - dummy prod run\n');

  log('## 1. Enactment + escalation lifecycle');
  const r1 = await gw.decide(
    p({ tool: 'read_file', declaredAction: 'read', resource: { kind: 'file', id: 'sandbox/notes.txt' }, args: { path: 'sandbox/notes.txt' } }),
  );
  log(`  read sandbox/notes.txt       -> ${r1.decision}  (downstream files.received=${files.received.length})`);
  const r2 = await gw.decide(
    p({ tool: 'write_file', declaredAction: 'write', resource: { kind: 'file', id: 'sandbox/out.txt' }, args: { path: 'sandbox/out.txt' } }),
  );
  log(`  write sandbox/out.txt        -> ${r2.decision}  (held, not executed)`);
  await gw.resolveEscalation(r2.decisionId, { resolution: 'approve', resolvedBy: ALICE });
  log(`  approve escalation by alice  -> executed downstream: ${files.received.some((c: any) => c.tool === 'write_file')}`);

  log('\n## 2. Scenario 1 - trusted-channel exploit (enforceable inline)');
  const r3 = await gw.decide(
    p({ tool: 'http_fetch', declaredAction: 'egress', resource: { kind: 'egress', id: 'api.allowed.example' }, args: { domain: 'api.allowed.example', payload: 'PROTECTED:customer-records' } }),
  );
  log(`  egress allow-listed + payload -> ${r3.decision}  ("${r3.reason}")  egress.received=${egress.received.length}`);

  log('\n## 3. Scenario 2 - cross-principal chain (enforceable inline via carried context)');
  const a = await gw.decide(p({ tool: 'read_crm', declaredAction: 'read', resource: { kind: 'crm', id: 'crm/customers' } }));
  log(`  read CRM                      -> ${a.decision}  (innocuous alone)`);
  const b = await gw.decide(
    p({ tool: 'send_external', declaredAction: 'send', resource: { kind: 'egress', id: 'partner.example' }, context: { priorContext: a.contextToken } }),
  );
  log(`  send external + prior context -> ${b.decision}  (sawPriorContext=${b.sawPriorContext})`);

  log('\n## 4. Scenario 3 - async provenance laundering (NOT enforceable inline)');
  const w = await gw.decide(p({ principal: WORKLOAD, tool: 'write_artefact', declaredAction: 'write', resource: { kind: 'artefact', id: 'artefacts/report.pdf' } }));
  const rd = await gw.decide(p({ principal: AGENT, tool: 'read_artefact', declaredAction: 'read', resource: { kind: 'artefact', id: 'artefacts/report.pdf' } }));
  log(`  artefact write (workload) -> ${w.decision}; read (agent) -> ${rd.decision}  (both allowed inline)`);

  log('\n## 5. Readback + offline receipt verification');
  const decisions = gw.decisions({});
  const pem = gw.keys().keys[0].publicKey;
  let verified = 0;
  for (const d of decisions) if (verifyReceipt(gw.receipt(d.receiptRef).receipt, pem)) verified += 1;
  log(`  decisions recorded: ${decisions.length}; receipts verifying offline against /keys: ${verified}/${decisions.length}`);
  const sample = gw.receipt(decisions[0].receiptRef).receipt;
  const tampered = { ...sample, decision: sample.decision === 'allow' ? 'deny' : 'allow' } as SignedReceipt;
  log(`  tamper one receipt -> verifies? ${verifyReceipt(tampered, pem)}  (expect false)`);
  const s = gw.state(decisions[0].decisionId);
  log(`  /state pins policyVersion: ${s.assumed.policyVersion.slice(0, 16)}...`);

  log('\n## 6. Reconciliation (flag-for-review only, never reverts)');
  const report = await gw.reconcile({ since: '2026-06-01T00:00:00.000Z' });
  const kinds: Record<string, number> = {};
  for (const f of report.flags) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  log(`  flags: ${JSON.stringify(kinds)}; actionsTaken: ${JSON.stringify(report.actionsTaken)}; has 'reverted' field: ${'reverted' in report}`);

  log('\n## 7. Policy simulation against recorded traffic');
  const tighten = src('tighten', 'drp-demo-v1', '@id("sandbox-read-allow")\npermit ( principal, action == Action::"read", resource )\nwhen { resource.path like "sandbox/*" };\n');
  tighten.rules = [{ id: 'sandbox-read-allow', principals: ['*'], effect: 'allow', summary: 'read' }];
  const diff = await gw.simulatePolicy(tighten);
  log(`  trafficSource=${diff.trafficSource}; flipped=${diff.flipped.length}; unchanged=${diff.unchanged}`);

  log('\n## 8. Arbitration within one vocabulary + cross-framework limit');
  const arb = await gw.decide(p({}), { sources: ['lenient', 'strict'], resolver: 'most-restrictive' });
  log(`  lenient vs strict (most-restrictive) -> ${arb.decision}; winner=${arb.arbitration?.winner}; conflicts logged=${gw.conflicts().length}`);
  try {
    await gw.decide(p({}), { sources: ['lenient', 'foreign'] });
    log('  cross-framework -> NOT rejected (unexpected)');
  } catch (e) {
    log(`  cross-framework -> rejected: "${(e as Error).message}"`);
  }

  log('\n## 9. Telemetry');
  const events = exporter.getFinishedSpans().flatMap((sp) => sp.events.map((e) => e.name));
  log(`  drp.decision OTel events emitted: ${events.filter((n) => n === 'drp.decision').length}`);

  log('\nDone.');
}

void main();
