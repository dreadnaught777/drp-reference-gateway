/**
 * Cedar provider (embedded WASM, @cedar-policy/cedar-wasm). Maps
 * principal/action/resource onto Cedar entities; evaluates with isAuthorized;
 * forbid and no-match both surface as deny, distinguished in reason.
 *
 * Cedar has no third effect. Escalation is a matched rule whose id the bundle
 * manifest tags as effect "escalate" (build brief section 9): after an Allow,
 * the determining policy id is looked up in the manifest and an escalate-tagged
 * rule yields effect "escalate".
 *
 * Policies are loaded keyed by their @id annotation (via policySetTextToParts)
 * so the determining-policy diagnostics carry the rule id, not an auto-id.
 */

import * as cedar from '@cedar-policy/cedar-wasm/nodejs';
import type { DrpProvider, EngineInput, EngineDecision, LoadedPolicy } from './types';
import type { Effect, PolicyBundle } from '../types';

interface CedarLoadedPolicy extends LoadedPolicy {
  /** Cedar policy text keyed by @id. */
  byId: Record<string, string>;
  /** Manifest-declared effect for each rule id (allow/deny/escalate). */
  effectById: Record<string, Effect>;
}

/** Split a Cedar bundle into individual policy texts keyed by their @id. */
function splitById(source: string): Record<string, string> {
  const byId: Record<string, string> = {};
  if (!source || source.trim().length === 0) return byId;
  const parts = cedar.policySetTextToParts(source);
  if (parts.type !== 'success') {
    const detail = parts.errors.map((e) => e.message).join('; ');
    throw new Error(`cedar: could not parse policy set - ${detail}`);
  }
  let anon = 0;
  for (const policy of parts.policies) {
    const m = policy.match(/@id\("([^"]+)"\)/);
    const id = m ? m[1] : `anon-${anon++}`;
    byId[id] = policy;
  }
  return byId;
}

export class CedarProvider implements DrpProvider {
  readonly name = 'cedar' as const;

  async load(bundle: PolicyBundle): Promise<LoadedPolicy> {
    const byId = splitById(bundle.source ?? '');

    // Validate the policy set parses (a malformed bundle must not load).
    const check = cedar.checkParsePolicySet({ staticPolicies: byId });
    if (check.type !== 'success') {
      const detail = check.errors.map((e) => e.message).join('; ');
      throw new Error(`cedar: invalid policy bundle - ${detail}`);
    }

    const effectById: Record<string, Effect> = {};
    for (const rule of bundle.rules ?? []) {
      effectById[rule.id] = rule.effect;
    }

    const loaded: CedarLoadedPolicy = {
      bundleVersion: bundle.bundleVersion,
      vocabulary: bundle.vocabulary,
      byId,
      effectById,
    };
    return loaded;
  }

  async evaluate(input: EngineInput, policy: LoadedPolicy): Promise<EngineDecision> {
    const loaded = policy as CedarLoadedPolicy;
    const resourceUid = { type: 'Resource', id: input.resource.id };
    const principalUid = { type: 'Principal', id: input.principal };

    const domain = typeof input.args.domain === 'string' ? input.args.domain : '';

    const answer = cedar.isAuthorized({
      principal: principalUid,
      action: { type: 'Action', id: input.declaredAction },
      resource: resourceUid,
      context: {},
      policies: { staticPolicies: loaded.byId },
      entities: [
        { uid: principalUid, attrs: {}, parents: [] },
        {
          uid: resourceUid,
          attrs: { path: input.resource.id, kind: input.resource.kind, domain },
          parents: [],
        },
      ],
    });

    if (answer.type !== 'success') {
      const detail = answer.errors.map((e) => e.message).join('; ');
      throw new Error(`cedar: evaluation failed - ${detail}`);
    }

    const { decision, diagnostics } = answer.response;
    const determining = diagnostics.reason[0] ?? null;

    if (decision === 'deny') {
      return {
        effect: 'deny',
        matchedRuleId: determining,
        reason: determining
          ? `denied by rule ${determining}`
          : 'default-deny: no rule matched',
      };
    }

    // Allow from Cedar. Resolve the manifest-declared effect for the rule.
    const manifestEffect = determining ? loaded.effectById[determining] : undefined;
    const effect: Effect = manifestEffect === 'escalate' ? 'escalate' : 'allow';
    return {
      effect,
      matchedRuleId: determining,
      reason: determining ? `matched rule ${determining}` : 'allow',
    };
  }
}
