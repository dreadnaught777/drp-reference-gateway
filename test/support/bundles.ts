/**
 * Policy-bundle fixtures for the harness. The default bundle is the committed
 * Cedar policy plus its manifest (the manifest supplies the escalate tagging);
 * emptyBundle proves default-deny needs no rules (Suite A).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { PolicyBundle, PolicyManifest } from '../../src/types';

const cedarUrl = new URL('../../fixtures/policy.cedar', import.meta.url);
const manifestUrl = new URL('../../fixtures/drp.manifest.json', import.meta.url);
const wasmUrl = new URL('../../fixtures/policy.wasm', import.meta.url);

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
