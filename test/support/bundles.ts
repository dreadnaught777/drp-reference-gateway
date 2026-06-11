/**
 * Policy-bundle fixtures for the harness. The default bundle is the committed
 * Cedar policy plus its manifest (the manifest supplies the escalate tagging);
 * emptyBundle proves default-deny needs no rules (Suite A).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { PolicyBundle, PolicyManifest } from '../../src/types';
import type { RecordedEntry } from '../../src/simulate/policy';

const cedarUrl = new URL('../../fixtures/policy.cedar', import.meta.url);
const manifestUrl = new URL('../../fixtures/drp.manifest.json', import.meta.url);
const wasmUrl = new URL('../../fixtures/policy.wasm', import.meta.url);
const trafficUrl = new URL('../../fixtures/recordedTraffic.jsonl', import.meta.url);

function bundleVersionOf(source: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

function manifest(): PolicyManifest {
  return JSON.parse(readFileSync(fileURLToPath(manifestUrl), 'utf8')) as PolicyManifest;
}

export function defaultCedarBundle(): PolicyBundle {
  const source = readFileSync(fileURLToPath(cedarUrl), 'utf8');
  const m = manifest();
  return {
    bundleVersion: bundleVersionOf(source),
    vocabulary: m.vocabulary,
    engine: 'cedar',
    source,
    rules: m.rules,
  };
}

export function defaultOpaBundle(): PolicyBundle {
  const wasm = readFileSync(fileURLToPath(wasmUrl));
  const m = manifest();
  return {
    bundleVersion: bundleVersionOf(wasm),
    vocabulary: m.vocabulary,
    engine: 'opa',
    wasm,
    rules: m.rules,
  };
}

/** The default bundle for a provider: Cedar source or the compiled Rego wasm. */
export function defaultBundleFor(provider: 'cedar' | 'opa'): PolicyBundle {
  return provider === 'opa' ? defaultOpaBundle() : defaultCedarBundle();
}

export const emptyBundle: PolicyBundle = {
  bundleVersion: 'sha256:empty',
  vocabulary: 'drp-demo-v1',
  engine: 'cedar',
  source: '',
  rules: [],
};

/**
 * A different, valid bundle for the readback tests (Suite D): it loads cleanly
 * and carries a distinct bundleVersion, so reloading it moves the effective
 * version on. Tighter than the default - only the sandbox read rule remains.
 */
const stricterSource = [
  '@id("sandbox-read-allow")',
  'permit (',
  '  principal,',
  '  action == Action::"read",',
  '  resource',
  ')',
  'when { resource.path like "sandbox/*" };',
  '',
].join('\n');

export const stricterPolicy: PolicyBundle = {
  bundleVersion: bundleVersionOf(stricterSource),
  vocabulary: 'drp-demo-v1',
  engine: 'cedar',
  source: stricterSource,
  rules: [
    {
      id: 'sandbox-read-allow',
      principals: ['spiffe://demo/agent/*'],
      effect: 'allow',
      summary: 'read-path in sandbox',
    },
  ],
};

/**
 * A candidate that tightens egress: it keeps the sandbox-read and write rules
 * but drops the egress allow-list, so a recorded egress 'allow' flips to 'deny'
 * under simulation (Suite E mode b).
 */
const tightenEgressSource = [
  '@id("sandbox-read-allow")',
  'permit ( principal, action == Action::"read", resource )',
  'when { resource.path like "sandbox/*" };',
  '',
  '@id("write-escalate")',
  'permit ( principal, action in [Action::"write", Action::"delete"], resource );',
  '',
].join('\n');

export const tightenEgress: PolicyBundle = {
  bundleVersion: bundleVersionOf(tightenEgressSource),
  vocabulary: 'drp-demo-v1',
  engine: 'cedar',
  source: tightenEgressSource,
  rules: [
    {
      id: 'sandbox-read-allow',
      principals: ['spiffe://demo/agent/*'],
      effect: 'allow',
      summary: 'read-path in sandbox',
    },
    { id: 'write-escalate', principals: ['*'], effect: 'escalate', summary: 'write/delete escalates' },
  ],
};

/**
 * A self-contradictory Cedar bundle: a permit and a forbid with identical scope
 * (read in the sandbox). The permit can never produce allow, so the set is
 * unsatisfiable and the load-time contradiction probe rejects it (Suite E).
 */
const contradictorySource = [
  '@id("contradict-permit")',
  'permit ( principal, action == Action::"read", resource )',
  'when { resource.path like "sandbox/*" };',
  '',
  '@id("contradict-forbid")',
  'forbid ( principal, action == Action::"read", resource )',
  'when { resource.path like "sandbox/*" };',
  '',
].join('\n');

export const contradictoryCedar: PolicyBundle = {
  bundleVersion: bundleVersionOf(contradictorySource),
  vocabulary: 'drp-demo-v1',
  engine: 'cedar',
  source: contradictorySource,
  rules: [],
};

/** Parse fixtures/recordedTraffic.jsonl into entries for policy simulation. */
export function loadRecordedTraffic(): RecordedEntry[] {
  const raw = readFileSync(fileURLToPath(trafficUrl), 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RecordedEntry);
}
