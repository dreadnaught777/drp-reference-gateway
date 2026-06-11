/**
 * Protocol-conformance helpers for Suite M. The committed YAML is the contract;
 * these helpers validate live handler responses against the committed response
 * schemas (ajv), per the spec-first discipline - the spec is the input, never
 * generated from the handlers.
 */

import Ajv2020 from 'ajv/dist/2020';
import { committedSpec } from './committedSpec';
import { readFileProposal } from './proposals';
import { agentId } from '../../fixtures/principals';
import type { GatewayClient } from './createGateway';

type AnyRecord = Record<string, unknown>;

/** Minimal structural check that a document is an OpenAPI 3.1 spec. Throws on
 * a document that is not. */
export function validateOpenApi(spec: unknown): void {
  if (!spec || typeof spec !== 'object') throw new Error('spec is not an object');
  const s = spec as AnyRecord;
  if (typeof s.openapi !== 'string' || !/^3\.1\.\d+$/.test(s.openapi)) {
    throw new Error(`openapi version is not 3.1.x: ${String(s.openapi)}`);
  }
  const info = s.info as AnyRecord | undefined;
  if (!info || typeof info.title !== 'string' || typeof info.version !== 'string') {
    throw new Error('spec is missing info.title / info.version');
  }
  if (!s.paths || typeof s.paths !== 'object') throw new Error('spec is missing paths');
}

/** The committed 200-response JSON schema object for an operationId. */
function responseSchemaFor(spec: AnyRecord, operationId: string): AnyRecord {
  const paths = spec.paths as Record<string, Record<string, AnyRecord>>;
  for (const methods of Object.values(paths)) {
    for (const op of Object.values(methods)) {
      if (op && op.operationId === operationId) {
        const responses = op.responses as AnyRecord;
        const ok = responses['200'] as AnyRecord;
        const content = ok.content as AnyRecord;
        const json = content['application/json'] as AnyRecord;
        return json.schema as AnyRecord;
      }
    }
  }
  throw new Error(`no operation ${operationId} in the committed spec`);
}

export interface ValidationResult {
  valid: boolean;
  errors: unknown[];
}

export function validateAgainstSpec(operationId: string, response: unknown): ValidationResult {
  const spec = committedSpec() as unknown as AnyRecord;
  const respSchema = responseSchemaFor(spec, operationId);
  // Wrap the response schema with the spec's components so its internal
  // $ref: '#/components/schemas/...' pointers resolve.
  const schema = { ...respSchema, components: spec.components };
  // strict:false ignores OpenAPI annotation keywords; logger:false silences the
  // "unknown format date-time" notice (format is annotation-only here).
  const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });
  const validate = ajv.compile(schema);
  const valid = validate(response);
  return { valid: Boolean(valid), errors: valid ? [] : (validate.errors ?? []) };
}

/** One representative call per sampled protocol endpoint. Each call returns the
 * wire-shaped response the endpoint produces, for validation against the spec. */
export const protocolSamples: {
  operationId: string;
  call: (client: GatewayClient) => Promise<unknown>;
}[] = [
  {
    operationId: 'decide',
    call: (client) => client.decide(readFileProposal('sandbox/notes.txt')),
  },
  {
    operationId: 'effectivePolicy',
    call: (client) => client.effectivePolicy(agentId),
  },
  {
    operationId: 'listDecisions',
    call: async (client) => {
      await client.decide(readFileProposal());
      return { decisions: await client.decisions({}) };
    },
  },
  {
    operationId: 'decisionState',
    call: async (client) => {
      const r = await client.decide(readFileProposal());
      return client.state(r.decisionId);
    },
  },
  {
    operationId: 'getKeys',
    call: (client) => client.keys(),
  },
  {
    operationId: 'getReceipt',
    call: async (client) => {
      const r = await client.decide(readFileProposal());
      const { receipt } = await client.receipt(r.receiptRef);
      // Wire shape: the signed body nested under `receipt`, detached sig/keyId
      // as siblings (the committed SignedReceipt schema; see DIVERGENCES D1).
      const { sig, keyId, ...body } = receipt;
      return { receipt: body, sig, keyId };
    },
  },
];

/** Readback-conformant surface (semantics section 8): the enact level plus the
 * readback and simulate endpoints. */
export const READBACK_CONFORMANT_PATHS = [
  '/v1/decide',
  '/v1/policy',
  '/v1/escalations',
  '/v1/receipts/r_sample',
  '/v1/keys',
  '/v1/openapi.json',
  '/v1/policy/effective',
  '/v1/decisions',
  '/v1/state/d_sample',
  '/v1/simulate/action',
  '/v1/simulate/policy',
];
