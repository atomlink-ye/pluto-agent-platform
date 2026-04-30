import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ObservabilityStore } from "@/observability/observability-store.js";
import { recordBudgetDecisionV0, type BudgetGateDecisionItemV0 } from "@/observability/budgets.js";

let workDir: string;
let store: ObservabilityStore;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-budget-audit-"));
  store = new ObservabilityStore({ dataDir: join(workDir, ".pluto") });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("recordBudgetDecisionV0", () => {
  it("persists auditable local approximation records with source refs and run correlation", async () => {
    const record = await recordBudgetDecisionV0({
      store,
      workspaceId: "workspace-a",
      correlationId: "run-1",
      actorId: "operator-1",
      principalId: "pluto.orchestrator",
      runId: "run-1",
      runAttempt: 2,
      clock: () => new Date("2026-04-30T00:10:00.000Z"),
      idGen: () => "fixed-id",
      decision: makeDecision(),
    });

    const stored = await store.get("budget_decision", record.id) as Record<string, unknown> | null;
    expect(stored).not.toBeNull();
    expect(stored?.["budgetId"]).toBe("budget-1");
    expect(stored?.["sourceRefs"]).toEqual([
      { kind: "budget", id: "budget-1" },
      { kind: "budget_snapshot", id: "snapshot-1" },
      { kind: "usage_meter", id: "usage-1" },
    ]);
    expect(stored?.["runCorrelation"]).toEqual({ runId: "run-1", runAttempt: 2 });
    expect(stored?.["approximateUsageLabels"]).toEqual(expect.arrayContaining([
      "local_approximation",
      "not_billing_truth",
      "usage_snapshot_fresh",
    ]));

    const audit = stored?.["audit"] as Record<string, unknown>;
    expect(audit["correlationId"]).toBe("run-1");
    expect(audit["actorId"]).toBe("operator-1");
    expect(audit["reasonCode"]).toBe("budget_require_override");
    expect(audit["action"]).toBe("run.budget.check");
    expect(audit["outcome"]).toBe("require_override");
  });
});

function makeDecision(): BudgetGateDecisionItemV0 {
  return {
    budgetId: "budget-1",
    budgetKey: "workspace-budget",
    scopeRef: { kind: "workspace", id: "workspace-a" },
    subjectRef: { kind: "team_run", id: "run-1" },
    snapshotId: "snapshot-1",
    usageMeterId: "usage-1",
    behavior: "require_override",
    overrideRequired: true,
    reason: "Budget workspace-budget returned require_override from local approximate token.output usage.",
    sourceRefs: [
      { kind: "budget", id: "budget-1" },
      { kind: "budget_snapshot", id: "snapshot-1" },
      { kind: "usage_meter", id: "usage-1" },
    ],
    approximationLabels: ["local_approximation", "not_billing_truth", "usage_snapshot_fresh"],
    driftNotes: ["Budget and usage records are local approximation signals, not billing truth."],
    usage: {
      approximate: true,
      billingTruth: false,
      freshness: "fresh",
      meterKey: "token.output",
      observedAt: "2026-04-30T00:05:00.000Z",
      consumed: 110,
      remaining: -10,
    },
  };
}
