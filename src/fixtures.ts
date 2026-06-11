/**
 * The demo policy bundle the standalone gateway ships with: the committed Cedar
 * fixture plus its manifest. Used by the HTTP server entrypoint (the
 * self-governing hook stretch); the test harness builds its own bundles.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { PolicyBundle, PolicyManifest } from './types';

const cedarUrl = new URL('../fixtures/policy.cedar', import.meta.url);
const manifestUrl = new URL('../fixtures/drp.manifest.json', import.meta.url);

export function defaultCedarBundle(): PolicyBundle {
  const source = readFileSync(fileURLToPath(cedarUrl), 'utf8');
  const manifest = JSON.parse(readFileSync(fileURLToPath(manifestUrl), 'utf8')) as PolicyManifest;
  return {
    bundleVersion: `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`,
    vocabulary: manifest.vocabulary,
    engine: 'cedar',
    source,
    rules: manifest.rules,
  };
}
