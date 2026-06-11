/**
 * Action-proposal builders for the suites. The base proposal() denies by
 * default (an unmapped tool, a resource matching no rule); the file builders
 * carry the declared action the fixture policy keys on.
 */

import type { ActionProposal } from '../../src/types';
import { agentId } from '../../fixtures/principals';

export function proposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    principal: agentId,
    identitySource: 'native',
    tool: 'noop',
    args: {},
    resource: { kind: 'unknown', id: 'n/a' },
    declaredAction: 'invoke',
    ...overrides,
  };
}

export function readFileProposal(path = 'sandbox/notes.txt'): ActionProposal {
  return {
    principal: agentId,
    identitySource: 'native',
    tool: 'read_file',
    args: { path },
    resource: { kind: 'file', id: path },
    declaredAction: 'read',
  };
}

export function writeFileProposal(path: string): ActionProposal {
  return {
    principal: agentId,
    identitySource: 'native',
    tool: 'write_file',
    args: { path },
    resource: { kind: 'file', id: path },
    declaredAction: 'write',
  };
}

export function deleteFileProposal(path: string): ActionProposal {
  return {
    principal: agentId,
    identitySource: 'native',
    tool: 'delete_file',
    args: { path },
    resource: { kind: 'file', id: path },
    declaredAction: 'delete',
  };
}

export function egressProposal(opts: { domain: string; payload?: string }): ActionProposal {
  const args: Record<string, unknown> = { domain: opts.domain };
  if (opts.payload !== undefined) args.payload = opts.payload;
  return {
    principal: agentId,
    identitySource: 'native',
    tool: 'http_fetch',
    args,
    resource: { kind: 'egress', id: opts.domain },
    declaredAction: 'egress',
  };
}

/** A read of CRM data - innocuous alone; the scenario-2 chain starts here. */
export function readCrmProposal(): ActionProposal {
  return {
    principal: agentId,
    identitySource: 'native',
    tool: 'read_crm',
    args: {},
    resource: { kind: 'crm', id: 'crm/customers' },
    declaredAction: 'read',
  };
}

/** A remote-contacting send. Base policy escalates it; a trusted prior read
 * carried in as priorContext makes the composite deny (scenario 2). */
export function sendExternalProposal(
  opts: { traceparent?: string | null; priorContext?: string } = {},
): ActionProposal {
  const context: ActionProposal['context'] = {};
  if (opts.traceparent != null) context.traceparent = opts.traceparent;
  if (opts.priorContext !== undefined) context.priorContext = opts.priorContext;
  return {
    principal: agentId,
    identitySource: 'native',
    tool: 'send_external',
    args: {},
    resource: { kind: 'egress', id: 'partner.example' },
    declaredAction: 'send',
    context,
  };
}

/** An artefact write. Allowed inline (scenario 3); the cross-principal
 * laundering is caught only in reconciliation. */
export function artefactWriteProposal(opts: { principal: string; at?: string }): ActionProposal {
  return {
    principal: opts.principal,
    identitySource: 'native',
    tool: 'write_artefact',
    args: opts.at ? { at: opts.at } : {},
    resource: { kind: 'artefact', id: 'artefacts/report.pdf' },
    declaredAction: 'write',
  };
}

/** An artefact read, later, by a different principal (scenario 3). */
export function artefactReadProposal(opts: { principal: string; at?: string }): ActionProposal {
  return {
    principal: opts.principal,
    identitySource: 'native',
    tool: 'read_artefact',
    args: opts.at ? { at: opts.at } : {},
    resource: { kind: 'artefact', id: 'artefacts/report.pdf' },
    declaredAction: 'read',
  };
}

/** Admit an artefact identified by its in-toto attestation subject (Suite H). */
export function artefactAdmission(opts: { subject: string }): ActionProposal {
  return {
    principal: opts.subject,
    identitySource: 'native',
    tool: 'admit_artefact',
    args: {},
    resource: { kind: 'artefact', id: opts.subject },
    declaredAction: 'admit',
  };
}

/**
 * Two distinct proposals for the receipt-chain tests (Suite C). Both deny
 * (unmapped tools) so the tamper test - which flips the decision to 'allow' -
 * genuinely changes the signed body.
 */
export function p1(): ActionProposal {
  return proposal({ tool: 'exotic_tool', args: { seq: 1 } });
}

export function p2(): ActionProposal {
  return proposal({ tool: 'another_unknown', args: { seq: 2 } });
}
