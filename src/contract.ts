/**
 * The committed protocol document. Served at GET /v1/openapi.json verbatim:
 * the gateway conforms to this contract, it does not generate it (spec-first
 * rule; Suite J). The YAML in spec/ is the input, parsed and returned as-is.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const specUrl = new URL('../spec/drp-runtime-protocol-v0.1.yaml', import.meta.url);

export function committedContract(): Record<string, unknown> {
  return parse(readFileSync(fileURLToPath(specUrl), 'utf8')) as Record<string, unknown>;
}
