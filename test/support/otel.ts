/**
 * In-memory OpenTelemetry harness for Suite C. Wires a BasicTracerProvider to
 * an InMemorySpanExporter and exposes the recorded span events as a flat list,
 * so a test can assert the drp.decision event reached the configured exporter.
 */

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { Tracer } from '@opentelemetry/api';

export interface RecordedEvent {
  name: string;
  attributes?: Record<string, unknown>;
}

export interface OtelHarness {
  tracer: Tracer;
  exporter: { readonly events: RecordedEvent[] };
}

export function createOtelHarness(): OtelHarness {
  const spanExporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
  });
  const tracer = provider.getTracer('drp-reference-gateway-test');

  return {
    tracer,
    exporter: {
      get events(): RecordedEvent[] {
        return spanExporter
          .getFinishedSpans()
          .flatMap((s) => s.events.map((e) => ({ name: e.name, attributes: e.attributes })));
      },
    },
  };
}
