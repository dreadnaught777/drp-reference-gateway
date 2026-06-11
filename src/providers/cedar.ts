/**
 * Cedar provider (embedded WASM). Maps principal/action/resource onto Cedar
 * entities; evaluates with isAuthorized; forbid and no-match both surface as
 * deny, distinguished in reason. Escalation is a matched escalate-tagged rule
 * identified via the manifest. See build brief section 9.
 *
 * M0 scaffold: not implemented. Gate: Suite A (M1), parity at Suite B (M3).
 */

import type { DrpProvider, EngineInput, EngineDecision, LoadedPolicy } from './types';
import type { PolicyBundle } from '../types';

export class CedarProvider implements DrpProvider {
  readonly name = 'cedar' as const;

  async load(_bundle: PolicyBundle): Promise<LoadedPolicy> {
    throw new Error('CedarProvider.load not implemented until M1');
  }

  async evaluate(_input: EngineInput, _policy: LoadedPolicy): Promise<EngineDecision> {
    throw new Error('CedarProvider.evaluate not implemented until M1');
  }
}
