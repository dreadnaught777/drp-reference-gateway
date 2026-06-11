/**
 * Loads and parses the committed protocol document from spec/ (test plan
 * section 0), for Suites J and M. The committed YAML is the contract: the
 * gateway serves it and conforms to it, it is never generated from handlers.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const specUrl = new URL('../../spec/drp-runtime-protocol-v0.1.yaml', import.meta.url);

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; [k: string]: unknown };
  paths: Record<string, unknown>;
  [k: string]: unknown;
}

/** Parse spec/drp-runtime-protocol-v0.1.yaml from the repo. */
export function committedSpec(): OpenApiDoc {
  const raw = readFileSync(fileURLToPath(specUrl), 'utf8');
  return parse(raw) as OpenApiDoc;
}
