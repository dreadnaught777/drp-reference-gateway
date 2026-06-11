/**
 * Telemetry. Each decision emits an OpenTelemetry event named drp.decision to
 * the configured exporter (Suite C asserts this reaches an in-memory exporter
 * in tests).
 *
 * M0 scaffold: signature only. Gate: Suite C (M2).
 */

import type { Decision } from './types';

export function emitDecisionEvent(_decision: Decision): void {
  throw new Error('OTel decision event not implemented until M2');
}
