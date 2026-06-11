/**
 * The shared scenario set for provider parity (Suite B). The same proposals are
 * run through Cedar and OPA and MUST produce identical decisions; expectedDecision
 * is the fixture intent expressed once, independently of either engine, so the
 * parity test also checks correctness, not just agreement.
 *
 * Intent (fixtures/policy.cedar and fixtures/policy.rego encode this identically):
 *   read in sandbox -> allow; write/delete -> escalate; the one allow-listed
 *   egress domain -> allow; everything else -> deny.
 */

import type { ActionProposal, Effect } from '../../src/types';
import {
  readFileProposal,
  writeFileProposal,
  deleteFileProposal,
  egressProposal,
  proposal,
} from './proposals';

const ALLOWLISTED_DOMAIN = 'api.allowed.example';

export const sharedScenarioSet: ActionProposal[] = [
  readFileProposal('sandbox/notes.txt'), // allow
  readFileProposal('etc/passwd'), // deny - read outside the sandbox
  writeFileProposal('sandbox/out.txt'), // escalate
  deleteFileProposal('sandbox/old.txt'), // escalate
  egressProposal(ALLOWLISTED_DOMAIN), // allow
  egressProposal('evil.example'), // deny - not the allow-listed domain
  proposal({ tool: 'exotic_tool' }), // deny - no rule matches
];

export function expectedDecision(p: ActionProposal): Effect {
  if (p.declaredAction === 'read' && p.resource.id.startsWith('sandbox/')) return 'allow';
  if (p.declaredAction === 'write' || p.declaredAction === 'delete') return 'escalate';
  if (p.declaredAction === 'egress' && p.args.domain === ALLOWLISTED_DOMAIN) return 'allow';
  return 'deny';
}

/**
 * A reconciliation window start before any recorded traffic (Suite F). The
 * recorded entries are dated 2026-06-10, so this includes all of them.
 */
export const t0 = '2026-06-01T00:00:00.000Z';
