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
