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
