/**
 * OPA provider (embedded WASM, @open-policy-agent/opa-wasm). The entrypoint
 * drp/decision returns { effect, rule, reason } directly from Rego, so unlike
 * Cedar there is no third-effect mapping: the Rego encodes allow/escalate/deny
 * natively. Fixtures are compiled with `opa build -t wasm -e drp/decision`
 * (scripts/build-rego.sh). See build brief section 9.
 *
 * The provider sits behind the same DrpProvider interface as Cedar; parity over
 * the shared scenario set (Suite B) is the proof the abstraction holds.
 */

import { loadPolicy } from '@open-policy-agent/opa-wasm';
import type { LoadedPolicy as OpaWasmPolicy } from '@open-policy-agent/opa-wasm';
import type { DrpProvider, EngineInput, EngineDecision, LoadedPolicy } from './types';
import type { Effect, PolicyBundle } from '../types';

interface OpaLoadedPolicy extends LoadedPolicy {
  policy: OpaWasmPolicy;
}

interface OpaDecision {
  effect?: unknown;
  rule?: unknown;
  reason?: unknown;
}

export class OpaProvider implements DrpProvider {
  readonly name = 'opa' as const;

  async load(bundle: PolicyBundle): Promise<LoadedPolicy> {
    if (!bundle.wasm) {
      throw new Error(
        'opa: bundle carries no compiled wasm (build it with scripts/build-rego.sh)',
      );
    }
    const policy = await loadPolicy(bundle.wasm);
    policy.setData({});
    const loaded: OpaLoadedPolicy = {
      bundleVersion: bundle.bundleVersion,
      vocabulary: bundle.vocabulary,
      policy,
    };
    return loaded;
  }

  async evaluate(input: EngineInput, policy: LoadedPolicy): Promise<EngineDecision> {
    const loaded = policy as OpaLoadedPolicy;
    // The Rego reads input.declaredAction, input.resource.id and
    // input.args.domain; pass the engine input through as the OPA document.
    const resultSet = loaded.policy.evaluate({
      principal: input.principal,
      declaredAction: input.declaredAction,
      tool: input.tool,
      resource: input.resource,
      args: input.args,
      priorContext: input.priorContext,
    }) as Array<{ result?: OpaDecision }>;

    const result = resultSet?.[0]?.result;
    if (!result || typeof result.effect !== 'string') {
      throw new Error('opa: entrypoint drp/decision returned no decision');
    }

    return {
      effect: result.effect as Effect,
      matchedRuleId: typeof result.rule === 'string' ? result.rule : null,
      reason: typeof result.reason === 'string' ? result.reason : '',
    };
  }
}
