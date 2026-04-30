import { describe, expect, it } from "vitest";

import type { BudgetSnapshotV0, BudgetV0, UsageMeterV0 } from "@/contracts/observability.js";
import { evaluateBudgetGateV0 } from "@/observability/budgets.js";

describe("evaluateBudgetGateV0", () => {
  it("returns allow when no active budgets match the scope", () => {
    const result = evaluateBudgetGateV0({
      scopeRef: { kind: "workspace", id: "workspace-a" },
      subjectRef: { kind: "team_run", id: "run-1" },
      budgets: [makeBudget({ scopeRef: { kind: "workspace", id: "workspace-b" } })],
      snapshots: [],
      usageMeters: [],
      now: "2026-04-30T00:10:00.000Z",
    });

    expect(result.behavior).toBe("allow");
    expect(result.decisions).toEqual([]);
  });

  it("returns warn when approximate usage crosses a warn threshold", () => {
    const budget = makeBudget({
      thresholds: [{ metricKey: "token.output", limit: 100, behavior: "warn" }],
    });
    const usage = makeUsageMeter({ id: "usage-1", meterKey: "token.output" });
    const snapshot = makeSnapshot({ budgetId: budget.id, usageMeterId: usage.id, consumed: 120, behavior: "allow" });

    const result = evaluateBudgetGateV0({
      scopeRef: budget.scopeRef,
      subjectRef: { kind: "team_run", id: "run-1" },
      budgets: [budget],
      snapshots: [snapshot],
      usageMeters: [usage],
      now: "2026-04-30T00:10:00.000Z",
    });

    expect(result.behavior).toBe("warn");
    expect(result.decisions[0]?.behavior).toBe("warn");
    expect(result.decisions[0]?.approximationLabels).toContain("local_approximation");
  });

  it("returns the highest-severity decision across active budgets", () => {
    const warnBudget = makeBudget({ id: "budget-warn", budgetKey: "warn-budget", thresholds: [{ metricKey: "token.output", limit: 100, behavior: "warn" }] });
    const blockBudget = makeBudget({ id: "budget-block", budgetKey: "block-budget", thresholds: [{ metricKey: "token.output", limit: 100, behavior: "block" }] });
    const usage = makeUsageMeter({ id: "usage-1", meterKey: "token.output" });

    const result = evaluateBudgetGateV0({
      scopeRef: warnBudget.scopeRef,
      subjectRef: { kind: "team_run", id: "run-1" },
      budgets: [warnBudget, blockBudget],
      snapshots: [
        makeSnapshot({ id: "snapshot-warn", budgetId: warnBudget.id, usageMeterId: usage.id, consumed: 120 }),
        makeSnapshot({ id: "snapshot-block", budgetId: blockBudget.id, usageMeterId: usage.id, consumed: 120 }),
      ],
      usageMeters: [usage],
      now: "2026-04-30T00:10:00.000Z",
    });

    expect(result.behavior).toBe("block");
    expect(result.decisions.map((decision) => decision.behavior)).toEqual(["warn", "block"]);
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
    quantity: 120,
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
