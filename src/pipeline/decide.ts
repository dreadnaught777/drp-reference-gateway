/**
 * The single decide path. Every action proposal, whether it arrives over HTTP
 * /v1/decide or through the MCP proxy, flows through this one pipeline:
 *   validate proposal -> assemble engine input -> evaluate via providers
 *   -> arbitrate if more than one source -> produce decision -> sign and
 *   chain receipt -> persist -> emit OTel event -> respond.
 *
 * M0 scaffold: signature only. Gate: Suite A (M1).
 */

import type { ActionProposal, Decision, ArbitrationRequest } from '../types';

export async function decide(
  _proposal: ActionProposal,
  _arbitration?: ArbitrationRequest,
): Promise<Decision> {
  throw new Error('decide pipeline not implemented until M1');
}
