import { describe, expect, it } from "vitest";

import {
  type AlertLifecycleV0 as RootAlertLifecycleV0,
  type BudgetBehaviorV0 as RootBudgetBehaviorV0,
  type CanonicalAuditEnvelopeV0 as RootCanonicalAuditEnvelopeV0,
  type RunHealthSummaryV0 as RootRunHealthSummaryV0,
} from "@/index.js";
import {
  validateAdapterHealthSummaryV0,
  validateAlertV0,
  validateBudgetDecisionV0,
  validateBudgetSnapshotV0,
  validateBudgetV0,
  validateDashboardDefinitionV0,
  validateMetricSeriesV0,
  validateRedactedTraceV0,
  validateRunHealthSummaryV0,
  validateUsageMeterV0,
} from "@/contracts/observability.js";

const audit: RootCanonicalAuditEnvelopeV0 = {
  eventId: "audit-1",
  eventType: "observability.recorded",
  recordedAt: "2026-04-30T00:00:00.000Z",
  correlationId: "corr-1",
  actorId: "user-1",
  principalId: "service-1",
  action: "observability.capture",
  target: "workspace:workspace-1",
  outcome: "recorded",
  reasonCode: "operator_approved",
  redaction: {
    containsSensitiveData: true,
    state: "redacted",
    redactionCount: 2,
    redactedPaths: ["details.token", "details.trace"],
  },
};

describe("observability contracts", () => {
  it("validates additive workspace-scoped schema-stamped records across the observability surface", () => {
    expect(validateMetricSeriesV0({
      schema: "pluto.observability.metric-series",
      schemaVersion: 0,
      kind: "metric_series",
      id: "metric-series-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit,
      metricKey: "run.latency_ms",
      unit: "ms",
      dimensions: [{ key: "adapter", value: "fake" }],
      points: [{ ts: "2026-04-30T00:00:00.000Z", value: 42 }],
    }).ok).toBe(true);

    const runSummary: RootRunHealthSummaryV0 = {
      schema: "pluto.observability.run-health-summary",
      schemaVersion: 0,
      kind: "run_health_summary",
      id: "run-health-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit,
      runId: "run-1",
      status: "succeeded",
      severity: "info",
      blockerReason: null,
      summary: "Run completed within latency and error budgets.",
      traceRef: { kind: "redacted_trace", id: "trace-1" },
      evidenceRefs: ["evidence:run-1-summary"],
      observedAt: "2026-04-30T00:00:01.000Z",
    };

    expect(validateRunHealthSummaryV0(runSummary).ok).toBe(true);

    expect(validateAdapterHealthSummaryV0({
      schema: "pluto.observability.adapter-health-summary",
      schemaVersion: 0,
      kind: "adapter_health_summary",
      id: "adapter-health-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit,
      adapterId: "adapter-1",
      adapterKind: "paseo-opencode",
      status: "degraded",
      severity: "warn",
      summary: "Queue depth is elevated but requests still drain.",
      observedAt: "2026-04-30T00:00:02.000Z",
    }).ok).toBe(true);

    expect(validateRedactedTraceV0({
      schema: "pluto.observability.redacted-trace",
      schemaVersion: 0,
      kind: "redacted_trace",
      id: "trace-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit,
      traceId: "trace-1",
      runId: "run-1",
      spanCount: 8,
      preview: "assistant -> adapter -> callback",
      redaction: audit.redaction,
      capturedAt: "2026-04-30T00:00:01.000Z",
    }).ok).toBe(true);

    const lifecycle: RootAlertLifecycleV0 = "triggered";
    expect(validateAlertV0({
      schema: "pluto.observability.alert",
      schemaVersion: 0,
      kind: "alert",
      id: "alert-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit,
      alertKey: "run.error-rate",
      lifecycle,
      severity: "critical",
      sourceRef: { kind: "run_health_summary", id: "run-health-1" },
      summary: "Error rate crossed the page threshold.",
      firstObservedAt: "2026-04-30T00:00:00.000Z",
      lastObservedAt: "2026-04-30T00:00:01.000Z",
      acknowledgedAt: null,
      resolvedAt: null,
    }).ok).toBe(true);

    expect(validateDashboardDefinitionV0({
      schema: "pluto.observability.dashboard-definition",
      schemaVersion: 0,
      kind: "dashboard_definition",
      id: "dashboard-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit,
      dashboardKey: "default-ops",
      title: "Default Ops",
      widgets: [{ id: "w-1", title: "Latency", seriesRefs: ["metric-series-1"] }],
    }).ok).toBe(true);

    expect(validateUsageMeterV0({
      schema: "pluto.observability.usage-meter",
      schemaVersion: 0,
      kind: "usage_meter",
      id: "usage-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit,
      meterKey: "token.output",
      subjectRef: { kind: "run_health_summary", id: "run-health-1" },
      quantity: 1024,
      unit: "tokens",
      window: { unit: "hour", value: 1 },
      measuredAt: "2026-04-30T00:00:01.000Z",
    }).ok).toBe(true);

    const behavior: RootBudgetBehaviorV0 = "require_override";
    expect(validateBudgetV0({
      schema: "pluto.observability.budget",
      schemaVersion: 0,
      kind: "budget",
      id: "budget-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit,
      budgetKey: "workspace-monthly-spend",
      scopeRef: { kind: "workspace", id: "workspace-1" },
      thresholds: [{ metricKey: "usd", limit: 100, behavior }],
      defaultBehavior: "warn",
      currency: "USD",
    }).ok).toBe(true);

    expect(validateBudgetSnapshotV0({
      schema: "pluto.observability.budget-snapshot",
      schemaVersion: 0,
      kind: "budget_snapshot",
      id: "budget-snapshot-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit,
      budgetId: "budget-1",
      usageMeterId: "usage-1",
      observedAt: "2026-04-30T00:00:01.000Z",
      consumed: 75,
      remaining: 25,
      behavior: "warn",
    }).ok).toBe(true);

    expect(validateBudgetDecisionV0({
      schema: "pluto.observability.budget-decision",
      schemaVersion: 0,
      kind: "budget_decision",
      id: "budget-decision-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit,
      budgetId: "budget-1",
      snapshotId: "budget-snapshot-1",
      subjectRef: { kind: "run_health_summary", id: "run-health-1" },
      behavior,
      overrideRequired: true,
      reason: "Monthly budget is nearly exhausted.",
      decidedAt: "2026-04-30T00:00:02.000Z",
    }).ok).toBe(true);
  });

  it("rejects malformed audit and redaction metadata on observability records", () => {
    const result = validateRedactedTraceV0({
      schema: "pluto.observability.redacted-trace",
      schemaVersion: 0,
      kind: "redacted_trace",
      id: "trace-1",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit: {
        ...audit,
        redaction: {
          containsSensitiveData: true,
          state: "redacted",
          redactionCount: 1,
          redactedPaths: ["payload.secret", 42],
        },
      },
      traceId: "trace-1",
      runId: "run-1",
      spanCount: 1,
      preview: "preview",
      redaction: {
        containsSensitiveData: true,
        state: "redacted",
        redactionCount: 1,
        redactedPaths: ["payload.secret"],
      },
      capturedAt: "2026-04-30T00:00:01.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain("audit.redaction.redactedPaths must be an array of strings");
  });

  it("rejects observability records that omit stable audit vocabulary fields", () => {
    const result = validateRunHealthSummaryV0({
      schema: "pluto.observability.run-health-summary",
      schemaVersion: 0,
      kind: "run_health_summary",
      id: "run-health-missing-audit-fields",
      workspaceId: "workspace-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      audit: {
        eventId: "audit-2",
        recordedAt: "2026-04-30T00:00:00.000Z",
        correlationId: "corr-2",
        actorId: "user-1",
        principalId: "service-1",
        reasonCode: null,
        redaction: audit.redaction,
      },
      runId: "run-1",
      status: "succeeded",
      severity: "info",
      blockerReason: null,
      summary: "summary",
      traceRef: null,
      evidenceRefs: [],
      observedAt: "2026-04-30T00:00:01.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual(expect.arrayContaining([
      "missing required field: eventType",
      "missing required field: action",
      "missing required field: target",
      "missing required field: outcome",
    ]));
  });
});
