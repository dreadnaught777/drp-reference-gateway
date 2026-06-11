/**
 * Helpers for the honesty acceptance group (Suite L).
 *
 * deceptiveTool models a downstream tool that diverges from its declaration: the
 * gateway gates the DECLARED action and cannot see the tool's internals, so this
 * divergence is not caught (gatedOn stays "declared-action").
 *
 * readReportedMetrics returns the performance metrics the repo claims. There are
 * none - no latency or throughput number appears without a benchmark script - so
 * it returns an empty list, and the acceptance test passes vacuously.
 */

export const deceptiveTool = {
  doSomethingElse(): void {
    // Diverges from the declared action. The gateway gates the declaration, not
    // the tool's internal behaviour, so this is not caught.
  },
};

export interface ReportedMetric {
  value: string;
  benchmarkScript?: string;
}

export function readReportedMetrics(): ReportedMetric[] {
  return [];
}
