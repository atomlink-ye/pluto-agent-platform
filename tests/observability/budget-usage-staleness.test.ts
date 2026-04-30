import { describe, expect, it } from "vitest";

import type { BudgetSnapshotV0, BudgetV0, UsageMeterV0 } from "@/contracts/observability.js";
import { evaluateBudgetGateV0 } from "@/observability/budgets.js";

describe("budget usage staleness", () => {
  it.each([
    ["block"],
    ["require_override"],
  ] as const)("fails conservatively for stale %s policies", (behavior) => {
    const budget = makeBudget({
      defaultBehavior: behavior,
      thresholds: [{ metricKey: "token.output", limit: 100, behavior }],
    });

    const result = evaluateBudgetGateV0({
      scopeRef: budget.scopeRef,
      subjectRef: { kind: "team_run", id: "run-1" },
      budgets: [budget],
      snapshots: [makeSnapshot({ observedAt: "2026-04-30T00:00:00.000Z" })],
      usageMeters: [makeUsageMeter()],
      now: "2026-04-30T01:00:00.000Z",
      snapshotMaxAgeMs: 60_000,
    });

    expect(result.behavior).toBe(behavior);
    expect(result.decisions[0]?.driftNotes.join(" ")).toContain("stale");
  });

  it.each([
    ["block"],
    ["require_override"],
  ] as const)("fails conservatively for missing %s policies", (behavior) => {
    const budget = makeBudget({
      defaultBehavior: behavior,
      thresholds: [{ metricKey: "token.output", limit: 100, behavior }],
    });

    const result = evaluateBudgetGateV0({
      scopeRef: budget.scopeRef,
      subjectRef: { kind: "team_run", id: "run-1" },
      budgets: [budget],
      snapshots: [],
      usageMeters: [makeUsageMeter()],
      now: "2026-04-30T01:00:00.000Z",
    });

    expect(result.behavior).toBe(behavior);
    expect(result.decisions[0]?.driftNotes.join(" ")).toContain("No approximate usage snapshot");
  });

  it("retains drift notes instead of silently allowing warn budgets with stale snapshots", () => {
    const budget = makeBudget({
      defaultBehavior: "warn",
      thresholds: [{ metricKey: "token.output", limit: 100, behavior: "warn" }],
    });

    const result = evaluateBudgetGateV0({
      scopeRef: budget.scopeRef,
      subjectRef: { kind: "team_run", id: "run-1" },
      budgets: [budget],
      snapshots: [makeSnapshot({ observedAt: "2026-04-30T00:00:00.000Z", consumed: 10 })],
      usageMeters: [makeUsageMeter()],
      now: "2026-04-30T01:00:00.000Z",
      snapshotMaxAgeMs: 60_000,
    });

    expect(result.behavior).toBe("allow");
    expect(result.decisions[0]?.driftNotes.join(" ")).toContain("stale");
    expect(result.decisions[0]?.approximationLabels).toContain("usage_snapshot_stale");
  });
});

function makeBudget(overrides: Partial<BudgetV0> = {}): BudgetV0 {
  return {
    schema: "pluto.observability.budget",
    schemaVersion: 0,
    kind: "budget",
    id: "budget-1",
    workspaceId: "workspace-a",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    audit: baseAudit("audit-budget-1", "corr-budget-1"),
    budgetKey: "workspace-budget",
    scopeRef: { kind: "workspace", id: "workspace-a" },
    thresholds: [{ metricKey: "token.output", limit: 999, behavior: "allow" }],
    defaultBehavior: "allow",
    currency: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<BudgetSnapshotV0> = {}): BudgetSnapshotV0 {
  return {
    schema: "pluto.observability.budget-snapshot",
    schemaVersion: 0,
    kind: "budget_snapshot",
    id: "snapshot-1",
    workspaceId: "workspace-a",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    audit: baseAudit("audit-snapshot-1", "corr-snapshot-1"),
    budgetId: "budget-1",
    usageMeterId: "usage-1",
    observedAt: "2026-04-30T00:05:00.000Z",
    consumed: 10,
    remaining: 90,
    behavior: "allow",
    ...overrides,
  };
}

function makeUsageMeter(overrides: Partial<UsageMeterV0> = {}): UsageMeterV0 {
  return {
    schema: "pluto.observability.usage-meter",
    schemaVersion: 0,
    kind: "usage_meter",
    id: "usage-1",
    workspaceId: "workspace-a",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    audit: baseAudit("audit-usage-1", "corr-usage-1"),
    meterKey: "token.output",
    subjectRef: { kind: "workspace", id: "workspace-a" },
    quantity: 10,
    unit: "tokens",
    window: { unit: "hour", value: 1 },
    measuredAt: "2026-04-30T00:05:00.000Z",
    ...overrides,
  };
}

function baseAudit(eventId: string, correlationId: string) {
  return {
    eventId,
    eventType: "budget.recorded",
    recordedAt: "2026-04-30T00:00:00.000Z",
    correlationId,
    actorId: "user-1",
    principalId: "svc-1",
    action: "budget.observe",
    target: correlationId,
    outcome: "recorded",
    reasonCode: null,
    redaction: {
      containsSensitiveData: false,
      state: "clear",
      redactionCount: 0,
      redactedPaths: [],
    },
  };
}
