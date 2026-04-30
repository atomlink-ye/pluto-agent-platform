import { describe, expect, it } from "vitest";

import type { MetricSeriesV0, RunHealthSummaryV0 } from "@/contracts/observability.js";
import {
  filterObservabilityRecords,
  getObservabilityAction,
  getObservabilityAdapter,
  getObservabilityBlockerReason,
  getObservabilityCostClass,
  getObservabilitySchedule,
  getObservabilityTarget,
  queryObservabilityRecords,
} from "@/observability/query.js";

describe("observability audit envelope query helpers", () => {
  it("matches additive audit envelope fields and metric dimensions deterministically", () => {
    const records = [
      {
        schema: "pluto.observability.run-health-summary",
        schemaVersion: 0,
        kind: "run_health_summary",
        id: "run-1",
        workspaceId: "workspace-1",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
        audit: {
          eventId: "audit-1",
          eventType: "run_health_summary.recorded",
          recordedAt: "2026-04-30T00:00:00.000Z",
          correlationId: "corr-1",
          actorId: "user-1",
          principalId: "svc-1",
          action: "run.observe",
          target: "run-1",
          outcome: "blocked",
          reasonCode: "operator_approved",
          redaction: clearRedaction(),
          scheduleId: "nightly",
          costClass: "premium",
        },
        runId: "run-1",
        status: "blocked",
        severity: "warn",
        blockerReason: "runtime_timeout",
        summary: "Blocked run.",
        traceRef: null,
        evidenceRefs: [],
        observedAt: "2026-04-30T00:00:02.000Z",
      } as unknown as RunHealthSummaryV0,
      {
        schema: "pluto.observability.metric-series",
        schemaVersion: 0,
        kind: "metric_series",
        id: "metric-1",
        workspaceId: "workspace-1",
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
        audit: {
          eventId: "audit-2",
          eventType: "metric_series.recorded",
          recordedAt: "2026-04-30T00:00:00.000Z",
          correlationId: "corr-2",
          actorId: "system",
          principalId: "svc-1",
          action: "metric.capture",
          target: "metric-1",
          outcome: "recorded",
          reasonCode: null,
          redaction: clearRedaction(),
        },
        metricKey: "run.duration_ms",
        unit: "ms",
        dimensions: [
          { key: "adapter", value: "paseo-opencode" },
          { key: "schedule", value: "nightly" },
          { key: "cost_class", value: "premium" },
        ],
        points: [{ ts: "2026-04-30T00:00:01.000Z", value: 42 }],
      } as unknown as MetricSeriesV0,
    ];

    expect(getObservabilityAction(records[0]!)).toBe("run.observe");
    expect(getObservabilityTarget(records[0]!)).toBe("run-1");
    expect(getObservabilitySchedule(records[0]!)).toBe("nightly");
    expect(getObservabilityCostClass(records[0]!)).toBe("premium");
    expect(getObservabilityBlockerReason(records[0]!)).toBe("runtime_timeout");
    expect(getObservabilityAdapter(records[1]!)).toBe("paseo-opencode");
    expect(getObservabilitySchedule(records[1]!)).toBe("nightly");
    expect(getObservabilityCostClass(records[1]!)).toBe("premium");

    expect(filterObservabilityRecords([records[0]!], {
      actorId: "user-1",
      action: "run.observe",
      target: "run-1",
      blockerReason: "runtime_timeout",
      correlationId: "corr-1",
      reasonCode: "operator_approved",
    })).toHaveLength(1);
    expect(queryObservabilityRecords(records, { audit: { eventType: "run_health_summary.recorded", action: "run.observe", target: "run-1", outcome: "blocked" } })
      .map((record) => record.id)).toEqual(["run-1"]);
    expect(queryObservabilityRecords(records, { schedule: "nightly", costClass: "premium" }).map((record) => record.id)).toEqual([
      "run-1",
      "metric-1",
    ]);
  });
});

function clearRedaction() {
  return {
    containsSensitiveData: false,
    state: "clear",
    redactionCount: 0,
    redactedPaths: [],
  };
}
