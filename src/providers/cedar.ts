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
import canonicalize from 'canonicalize';
import type { DrpProvider, EngineInput, EngineDecision, LoadedPolicy } from './types';
import type { Effect, PolicyBundle } from '../types';

interface CedarLoadedPolicy extends LoadedPolicy {
  /** Cedar policy text keyed by @id. */
  byId: Record<string, string>;
  /** Manifest-declared effect for each rule id (allow/deny/escalate). */
  effectById: Record<string, Effect>;
  /** Manifest summary for each rule id, used as the decision reason. */
  summaryById: Record<string, string>;
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

/**
 * The scope of a policy - principal, action, resource and conditions - with
 * effect and annotations stripped, canonicalised for comparison. Two policies
 * with the same scope key target identical requests.
 */
function scopeKey(policyText: string): { effect: string; key: string } | null {
  const ans = cedar.policyToJson(policyText);
  if (ans.type !== 'success') return null;
  const json = ans.json as unknown as Record<string, unknown> & { effect?: string };
  const effect = String(json.effect ?? '');
  const { effect: _e, annotations: _a, ...scope } = json;
  void _e;
  void _a;
  return { effect, key: canonicalize(scope) ?? '' };
}

/**
 * Probe-based contradiction check (build brief R4; semantics section 6). This
 * is STATIC validation plus a scope comparison - NOT SMT-based automated
 * reasoning of the kind AWS runs. It rejects a policy set in which a permit and
 * a forbid share identical scope: the permit can never produce allow, so the
 * set is unsatisfiable on that scope.
 */
function assertNoContradiction(byId: Record<string, string>): void {
  const permits: { id: string; key: string }[] = [];
  const forbids: { id: string; key: string }[] = [];
  for (const [id, text] of Object.entries(byId)) {
    const sk = scopeKey(text);
    if (!sk) continue;
    if (sk.effect === 'permit') permits.push({ id, key: sk.key });
    else if (sk.effect === 'forbid') forbids.push({ id, key: sk.key });
  }
  for (const p of permits) {
    for (const f of forbids) {
      if (p.key === f.key) {
        throw new Error(
          `cedar: policy set is unsatisfiable - permit ${p.id} and forbid ${f.id} ` +
            `share identical scope (contradiction); the permit can never allow`,
        );
      }
    }
  }
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

    // Reject self-contradictory bundles before they can enforce (R4).
    assertNoContradiction(byId);

    const effectById: Record<string, Effect> = {};
    const summaryById: Record<string, string> = {};
    for (const rule of bundle.rules ?? []) {
      effectById[rule.id] = rule.effect;
      if (rule.summary) summaryById[rule.id] = rule.summary;
    }

    const loaded: CedarLoadedPolicy = {
      bundleVersion: bundle.bundleVersion,
      vocabulary: bundle.vocabulary,
      byId,
      effectById,
      summaryById,
    };
    return loaded;
  }

  async evaluate(input: EngineInput, policy: LoadedPolicy): Promise<EngineDecision> {
    const loaded = policy as CedarLoadedPolicy;
    const resourceUid = { type: 'Resource', id: input.resource.id };
    const principalUid = { type: 'Principal', id: input.principal };

    const domain = typeof input.args.domain === 'string' ? input.args.domain : '';
    const payload = input.args.payload;

    // Request-context flags the policy reads. Always supplied so policies that
    // reference them never error on a missing attribute.
    const context = {
      payloadPresent: payload !== undefined && payload !== null && payload !== '',
      priorRead: input.priorContext != null && input.priorContext.action === 'read',
    };

    const answer = cedar.isAuthorized({
      principal: principalUid,
      action: { type: 'Action', id: input.declaredAction },
      resource: resourceUid,
      context,
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
    const summary = determining ? loaded.summaryById[determining] : undefined;

    if (decision === 'deny') {
      return {
        effect: 'deny',
        matchedRuleId: determining,
        reason: summary ?? (determining ? `denied by rule ${determining}` : 'default-deny: no rule matched'),
      };
    }

    // Allow from Cedar. Resolve the manifest-declared effect for the rule.
    const manifestEffect = determining ? loaded.effectById[determining] : undefined;
    const effect: Effect = manifestEffect === 'escalate' ? 'escalate' : 'allow';
    return {
      effect,
      matchedRuleId: determining,
      reason: summary ?? (determining ? `matched rule ${determining}` : 'allow'),
    };
  }
}
