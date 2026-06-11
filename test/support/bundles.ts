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

function bundleVersionOf(source: string): string {
  return `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`;
}

export function defaultCedarBundle(): PolicyBundle {
  const source = readFileSync(fileURLToPath(cedarUrl), 'utf8');
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(manifestUrl), 'utf8'),
  ) as PolicyManifest;
  return {
    bundleVersion: bundleVersionOf(source),
    vocabulary: manifest.vocabulary,
    engine: 'cedar',
    source,
    rules: manifest.rules,
  };
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
