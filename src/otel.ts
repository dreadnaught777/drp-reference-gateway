/**
 * Telemetry. Each decision emits an OpenTelemetry event named drp.decision.
 * The event is recorded on a span so it reaches whatever exporter the tracer
 * provider is configured with - an in-memory exporter in tests (Suite C), a
 * real collector in deployment.
 *
 * The gateway holds a Tracer (injected, or the global no-op when none is
 * configured), keeping telemetry a seam rather than a hard dependency.
 */

import type { Tracer } from '@opentelemetry/api';
import type { Decision } from './types';

export const DECISION_EVENT = 'drp.decision';

export function emitDecisionEvent(tracer: Tracer | undefined, decision: Decision): void {
  if (!tracer) return;
  const span = tracer.startSpan('drp.decide');
  span.addEvent(DECISION_EVENT, {
    decisionId: decision.decisionId,
    principal: decision.principal,
    decision: decision.decision,
    provider: decision.provider,
    policyVersion: decision.policyVersion,
    simulated: false,
  });
  span.end();
}
