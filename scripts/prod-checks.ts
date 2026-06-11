/**
 * Prod-readiness probes: the four checks we can run against the system today,
 * beyond the transcribed suites. Writes a structured results file to
 * docs/prod-checks-results.json and prints a summary. Run with: npm run checks
 *
 *   1. default-deny + receipt invariants (fuzz)
 *   2. provider parity (fuzz, Cedar vs OPA)
 *   3. long-run receipt-chain audit
 *   4. negative / malformed input over HTTP
 *
 * Randomness is seeded, so a run is reproducible.
 */

import { createHash, createPublicKey, verify as edVerify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import canonicalize from 'canonicalize';
import { createGatewayCore } from '../src/gateway';
import { defaultCedarBundle } from '../src/fixtures';
import { startGatewayServer } from '../src/httpServer';
import { hashReceiptBody } from '../src/state/chain';
import type { ActionProposal, Effect, PolicyBundle, PolicyManifest, SignedReceipt } from '../src/types';

const resultsUrl = new URL('../docs/prod-checks-results.json', import.meta.url);
const wasmUrl = new URL('../fixtures/policy.wasm', import.meta.url);
const manifestUrl = new URL('../fixtures/drp.manifest.json', import.meta.url);

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)];
const id = (r: () => number): string => Math.floor(r() * 1e9).toString(36);

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

const PRINCIPALS = [
  'spiffe://demo/agent/email-helper',
  'spiffe://demo/workload/etl',
  'spiffe://demo/human/alice',
  'spiffe://demo/device/laptop-7',
];

/** A proposal drawn from the fixture intent, with the effect it should produce. */
function knownProposal(r: () => number): { proposal: ActionProposal; expected: Effect } {
  const principal = pick(r, PRINCIPALS);
  const shapes: (() => { proposal: ActionProposal; expected: Effect })[] = [
    () => ({ proposal: { principal, tool: 'read_file', declaredAction: 'read', resource: { kind: 'file', id: `sandbox/${id(r)}` }, args: {} }, expected: 'allow' }),
    () => ({ proposal: { principal, tool: 'read_crm', declaredAction: 'read', resource: { kind: 'crm', id: `crm/${id(r)}` }, args: {} }, expected: 'allow' }),
    () => ({ proposal: { principal, tool: 'read_artefact', declaredAction: 'read', resource: { kind: 'artefact', id: `artefacts/${id(r)}` }, args: {} }, expected: 'allow' }),
    () => ({ proposal: { principal, tool: 'read_file', declaredAction: 'read', resource: { kind: 'file', id: `etc/${id(r)}` }, args: {} }, expected: 'deny' }),
    () => ({ proposal: { principal, tool: 'write_file', declaredAction: 'write', resource: { kind: 'file', id: `sandbox/${id(r)}` }, args: {} }, expected: 'escalate' }),
    () => ({ proposal: { principal, tool: 'delete_file', declaredAction: 'delete', resource: { kind: 'file', id: `sandbox/${id(r)}` }, args: {} }, expected: 'escalate' }),
    () => ({ proposal: { principal, tool: 'write_artefact', declaredAction: 'write', resource: { kind: 'artefact', id: `artefacts/${id(r)}` }, args: {} }, expected: 'allow' }),
    () => ({ proposal: { principal, tool: 'send_external', declaredAction: 'send', resource: { kind: 'egress', id: 'partner.example' }, args: {} }, expected: 'escalate' }),
    () => ({ proposal: { principal, tool: 'http_fetch', declaredAction: 'egress', resource: { kind: 'egress', id: 'api.allowed.example' }, args: { domain: 'api.allowed.example' } }, expected: 'allow' }),
    () => ({ proposal: { principal, tool: 'http_fetch', declaredAction: 'egress', resource: { kind: 'egress', id: 'api.allowed.example' }, args: { domain: 'api.allowed.example', payload: `secret-${id(r)}` } }, expected: 'deny' }),
    () => ({ proposal: { principal, tool: 'http_fetch', declaredAction: 'egress', resource: { kind: 'egress', id: 'evil.example' }, args: { domain: 'evil.example' } }, expected: 'deny' }),
  ];
  return pick(r, shapes)();
}

/** A proposal whose action/resource matches no rule: default-deny must fire. */
function junkProposal(r: () => number): ActionProposal {
  const action = pick(r, ['invoke', 'frobnicate', 'launch', 'probe', 'mutate-state', 'exfil']);
  return {
    principal: pick(r, PRINCIPALS),
    tool: `tool_${id(r)}`,
    declaredAction: action,
    resource: { kind: pick(r, ['unknown', 'widget', 'gadget']), id: id(r) },
    args: {},
  };
}

function opaBundle(): PolicyBundle {
  const wasm = readFileSync(fileURLToPath(wasmUrl));
  const manifest = JSON.parse(readFileSync(fileURLToPath(manifestUrl), 'utf8')) as PolicyManifest;
  return {
    bundleVersion: `sha256:${createHash('sha256').update(wasm).digest('hex')}`,
    vocabulary: manifest.vocabulary,
    engine: 'opa',
    wasm,
    rules: manifest.rules,
  };
}

// --- Check 1: default-deny + receipt invariants ---------------------------
async function checkDefaultDenyAndReceipts() {
  const N = 1000;
  const gw = createGatewayCore({ provider: 'cedar', policy: defaultCedarBundle(), downstreams: [] });
  const pem = gw.keys().keys[0].publicKey;
  const r = rng(1);
  let denied = 0, allowed = 0, escalated = 0;
  let oracleMismatch = 0, junkLeaked = 0, receiptsVerified = 0, tampersDetected = 0, tampersTried = 0;

  for (let i = 0; i < N; i++) {
    const isJunk = r() < 0.4;
    const { proposal, expected } = isJunk
      ? { proposal: junkProposal(r), expected: 'deny' as Effect }
      : knownProposal(r);
    const d = await gw.decide(proposal);
    if (d.decision === 'deny') denied++;
    else if (d.decision === 'allow') allowed++;
    else escalated++;
    if (isJunk && d.decision !== 'deny') junkLeaked++;
    if (!isJunk && d.decision !== expected) oracleMismatch++;

    const { receipt } = gw.receipt(d.receiptRef);
    if (verifyReceipt(receipt, pem)) receiptsVerified++;
    if (i % 50 === 0) {
      tampersTried++;
      const tampered = { ...receipt, decision: receipt.decision === 'allow' ? 'deny' : 'allow' } as SignedReceipt;
      if (!verifyReceipt(tampered, pem)) tampersDetected++;
    }
  }

  const passed = junkLeaked === 0 && oracleMismatch === 0 && receiptsVerified === N && tampersDetected === tampersTried;
  return {
    id: 'default-deny-and-receipts',
    title: 'Default-deny + receipt invariants (fuzz)',
    samples: N,
    passed,
    metrics: { denied, allowed, escalated, junkLeaked, oracleMismatch, receiptsVerified, tampersTried, tampersDetected },
  };
}

// --- Check 2: provider parity (Cedar vs OPA) ------------------------------
async function checkProviderParity() {
  const N = 1000;
  const cedar = createGatewayCore({ provider: 'cedar', policy: defaultCedarBundle(), downstreams: [] });
  const opa = createGatewayCore({ provider: 'opa', policy: opaBundle(), downstreams: [] });
  const r = rng(2);
  let mismatches = 0;
  const examples: unknown[] = [];
  for (let i = 0; i < N; i++) {
    const proposal = r() < 0.4 ? junkProposal(r) : knownProposal(r).proposal;
    const [c, o] = [await cedar.decide(structuredClone(proposal)), await opa.decide(structuredClone(proposal))];
    if (c.decision !== o.decision) {
      mismatches++;
      if (examples.length < 5) examples.push({ proposal, cedar: c.decision, opa: o.decision });
    }
  }
  return {
    id: 'provider-parity',
    title: 'Provider parity (fuzz, Cedar vs OPA)',
    samples: N,
    passed: mismatches === 0,
    metrics: { mismatches },
    examples,
  };
}

// --- Check 3: long-run receipt-chain audit --------------------------------
async function checkChainAudit() {
  const N = 3000;
  const gw = createGatewayCore({ provider: 'cedar', policy: defaultCedarBundle(), downstreams: [] });
  const pem = gw.keys().keys[0].publicKey;
  const r = rng(3);
  const start = Date.now();
  for (let i = 0; i < N; i++) await gw.decide(r() < 0.4 ? junkProposal(r) : knownProposal(r).proposal);
  const decideMs = Date.now() - start;

  const history = gw.store.listHistory();
  let prev = 'genesis', linksOk = 0, sigsOk = 0;
  for (const h of history) {
    const dec = gw.store.getDecision(h.decisionId)!;
    const receipt = gw.store.getReceipt(dec.receiptRef)!;
    if (receipt.prevHash === prev) linksOk++;
    prev = hashReceiptBody(receipt);
    if (verifyReceipt(receipt, pem)) sigsOk++;
  }
  const chainLength = history.length;
  const passed = chainLength === N && linksOk === N && sigsOk === N;
  return {
    id: 'long-run-chain-audit',
    title: 'Long-run receipt-chain audit',
    samples: N,
    passed,
    metrics: { chainLength, prevHashLinksOk: linksOk, signaturesOk: sigsOk, decideWallClockMs: decideMs },
  };
}

// --- Check 4: negative / malformed input over HTTP ------------------------
async function checkNegativeInput() {
  const server = await startGatewayServer({ provider: 'cedar', policy: defaultCedarBundle(), downstreams: [] });
  const base = server.url;
  const cases: { name: string; expectStatus: number; extra?: (b: any) => boolean; status?: number; body?: any; passed?: boolean }[] = [];

  async function probe(name: string, init: RequestInit, path: string, expectStatus: number, extra?: (b: any) => boolean) {
    const res = await fetch(`${base}${path}`, init);
    let body: any = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const passed = res.status === expectStatus && (extra ? extra(body) : true);
    cases.push({ name, expectStatus, status: res.status, body, passed });
  }

  try {
    await probe('invalid JSON body -> 400', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' }, '/v1/decide', 400);
    await probe('unknown tool -> 200 deny (deny is not a transport error)', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ principal: 'spiffe://demo/agent/x', tool: 'exotic', declaredAction: 'invoke', resource: { kind: 'unknown', id: 'n/a' }, args: {} }) }, '/v1/decide', 200, (b) => b?.decision === 'deny');
    await probe('proposal missing resource -> 4xx, no crash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ principal: 'p', tool: 't', declaredAction: 'read', args: {} }) }, '/v1/decide', 400);
    await probe('wrong method on /v1/decide -> 404', { method: 'GET' }, '/v1/decide', 404);
    await probe('unknown route -> 404', { method: 'GET' }, '/v1/nope', 404);
    await probe('healthz -> 200', { method: 'GET' }, '/v1/healthz', 200, (b) => b?.status === 'ok');
  } finally {
    await server.close();
  }

  const passed = cases.every((c) => c.passed);
  return { id: 'negative-malformed-input', title: 'Negative / malformed input over HTTP', samples: cases.length, passed, cases };
}

async function main() {
  const checks = [
    await checkDefaultDenyAndReceipts(),
    await checkProviderParity(),
    await checkChainAudit(),
    await checkNegativeInput(),
  ];
  const checksPassed = checks.filter((c) => c.passed).length;
  const results = {
    note: 'Reproducible probe of the four checks runnable today. Generated by scripts/prod-checks.ts (npm run checks). Randomness is seeded.',
    node: process.version,
    ranAt: new Date().toISOString(),
    summary: { checksRun: checks.length, checksPassed },
    checks,
  };
  writeFileSync(fileURLToPath(resultsUrl), JSON.stringify(results, null, 2) + '\n');

  console.log('# Prod-readiness checks\n');
  for (const c of checks) console.log(`  ${c.passed ? 'PASS' : 'FAIL'}  ${c.title}  ${JSON.stringify(c.metrics ?? { cases: (c as any).cases?.length })}`);
  console.log(`\n${checksPassed}/${checks.length} checks passed. Results: docs/prod-checks-results.json`);
  if (checksPassed !== checks.length) process.exitCode = 1;
}

void main();
