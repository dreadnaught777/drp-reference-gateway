/**
 * Suite M - Protocol conformance, spec-first.
 *
 * Transcribed verbatim from docs/drp-reference-gateway-tests-v2.md, Suite M.
 * The describe/it bodies below are the frozen test plan; the preamble binds the
 * harness symbols. Immutable after transcription (CLAUDE.md). Conformance
 * failures are spec-or-implementation defects: fixed, or recorded in
 * spec/DIVERGENCES.md, never silently absorbed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { createGateway, type GatewayHandle } from './support/createGateway';
import { committedSpec } from './support/committedSpec';
import { proposal } from './support/proposals';
import {
  validateOpenApi,
  validateAgainstSpec,
  protocolSamples,
  READBACK_CONFORMANT_PATHS,
} from './support/conformance';

let client: GatewayHandle;

beforeEach(() => {
  client = createGateway({ provider: 'cedar' });
});

// --- begin verbatim transcription (test plan Suite M) ---

describe('protocol conformance', () => {
  it('the committed spec parses as valid OpenAPI 3.1', () => {
    expect(() => validateOpenApi(committedSpec())).not.toThrow();
  });

  it('live responses validate against the committed schemas (sampled per endpoint)', async () => {
    // One representative call per protocol endpoint; each response body is
    // validated (ajv) against the response schema in the committed spec.
    for (const sample of protocolSamples) {
      const res = await sample.call(client);
      expect(validateAgainstSpec(sample.operationId, res)).toEqual({ valid: true, errors: [] });
    }
  });

  it('deny is not a transport error: a deny decision returns HTTP 200', async () => {
    const { status, body } = await client.rawDecide(proposal({ tool: 'exotic_tool' }));
    expect(status).toBe(200);
    expect(body.decision).toBe('deny');
  });

  it('the gateway is readback-conformant per semantics §8', async () => {
    // Enact level: decide, policy, escalations, receipts, keys, openapi.
    // Readback level adds: policy/effective, decisions, state, simulate.
    for (const path of READBACK_CONFORMANT_PATHS) {
      expect(await client.rawStatus(path)).not.toBe(404);
    }
  });

  it('layer functions are not claimed as protocol: reconcile and conflicts are absent from the committed spec', () => {
    const spec = committedSpec();
    expect(spec.paths).not.toHaveProperty('/reconcile');
    expect(spec.paths).not.toHaveProperty('/conflicts');
    // They exist on the gateway (Suites F, G) as DRP-layer functions; the split is the claim.
  });

  it('spec divergences are recorded, not silently resolved', () => {
    // The file must exist from M0. An empty findings section is a pass;
    // a behavioural difference between spec and implementation without an
    // entry here is a release-blocking defect.
    expect(fs.existsSync('spec/DIVERGENCES.md')).toBe(true);
  });
});

// --- end verbatim transcription ---
