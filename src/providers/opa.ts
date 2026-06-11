/**
 * OPA provider (embedded WASM). Entrypoint drp/decision returns
 * { effect, rule, reason } directly from Rego; fixtures are compiled with
 * `opa build -t wasm -e drp/decision`. See build brief section 9.
 *
 * M0 scaffold: not implemented. Gate: Suite B parity (M3).
 */

import type { DrpProvider, EngineInput, EngineDecision, LoadedPolicy } from './types';
import type { PolicyBundle } from '../types';

export class OpaProvider implements DrpProvider {
  readonly name = 'opa' as const;

  async load(_bundle: PolicyBundle): Promise<LoadedPolicy> {
    throw new Error('OpaProvider.load not implemented until M3');
  }

  async evaluate(_input: EngineInput, _policy: LoadedPolicy): Promise<EngineDecision> {
    throw new Error('OpaProvider.evaluate not implemented until M3');
  }
}
