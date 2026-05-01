import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import type { BudgetDecisionV0, BudgetSnapshotV0, BudgetV0, UsageMeterV0 } from "@/contracts/observability.js";
import type { TeamTask } from "@/contracts/types.js";
import { ObservabilityStore } from "@/observability/observability-store.js";
import { DEFAULT_TEAM } from "@/orchestrator/team-config.js";
import { RunStore } from "@/orchestrator/run-store.js";
import { TeamRunService } from "@/orchestrator/team-run-service.js";

let workDir: string;
let dataDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-budget-run-creation-"));
  dataDir = join(workDir, ".pluto");
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("budget gate run creation hook", () => {
  it("allows run creation to continue when the decision is warn", async () => {
    const workspaceId = join(workDir, "workspace-a");
    const observabilityStore = new ObservabilityStore({ dataDir });
    const budget = makeBudget({ workspaceId, scopeRef: { kind: "workspace", id: workspaceId }, thresholds: [{ metricKey: "token.output", limit: 100, behavior: "warn" }] });
    const usage = makeUsageMeter({ workspaceId, subjectRef: { kind: "workspace", id: workspaceId } });
    const snapshot = makeSnapshot({ workspaceId, budgetId: budget.id, usageMeterId: usage.id, consumed: 120, remaining: -20 });
    await observabilityStore.put(budget);
    await observabilityStore.put(usage);
    await observabilityStore.put(snapshot);

    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store: new RunStore({ dataDir }),
      observabilityStore,
      timeoutMs: 5_000,
      pumpIntervalMs: 1,
    });

    const result = await service.run(buildTask("warn-run", workspaceId));

    expect(result.status).toBe("completed");
    const decisions = await observabilityStore.query({ kind: "budget_decision", workspaceId });
    expect(decisions).toHaveLength(1);
    expect((decisions[0] as { behavior?: string } | undefined)?.behavior).toBe("warn");
  });

  it("blocks governed run creation before adapter start when override is required", async () => {
    const workspaceId = join(workDir, "workspace-b");
    const observabilityStore = new ObservabilityStore({ dataDir });
    const budget = makeBudget({
      workspaceId,
      scopeRef: { kind: "workspace", id: workspaceId },
      defaultBehavior: "require_override",
      thresholds: [{ metricKey: "token.output", limit: 100, behavior: "require_override" }],
    });
    await observabilityStore.put(budget);

    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store: new RunStore({ dataDir }),
      observabilityStore,
      timeoutMs: 5_000,
      pumpIntervalMs: 1,
    });

    const result = await service.run(buildTask("override-run", workspaceId));

    expect(result.status).toBe("failed");
    expect(result.blockerReason).toBe("quota_exceeded");
    expect(result.failure?.message).toContain("require_override");
    expect(result.events.map((event) => event.type)).toEqual(["run_started", "coordination_transcript_created", "blocker", "run_failed"]);
    const decisions = await observabilityStore.query({ kind: "budget_decision", workspaceId });
    expect(decisions).toHaveLength(1);
    expect((decisions[0] as { behavior?: string } | undefined)?.behavior).toBe("require_override");
  });

  it("allows governed run creation when a budget override is provided", async () => {
    const workspaceId = join(workDir, "workspace-c");
    const observabilityStore = new ObservabilityStore({ dataDir });
    const budget = makeBudget({
      workspaceId,
      scopeRef: { kind: "workspace", id: workspaceId },
      defaultBehavior: "require_override",
      thresholds: [{ metricKey: "token.output", limit: 100, behavior: "require_override" }],
    });
    const usage = makeUsageMeter({ workspaceId, subjectRef: { kind: "workspace", id: workspaceId } });
    const snapshot = makeSnapshot({ workspaceId, budgetId: budget.id, usageMeterId: usage.id, consumed: 120, remaining: -20 });
    await observabilityStore.put(budget);
    await observabilityStore.put(usage);
    await observabilityStore.put(snapshot);

    const adapter = new FakeAdapter({ team: DEFAULT_TEAM });
    const service = new TeamRunService({
      adapter,
      team: DEFAULT_TEAM,
      store: new RunStore({ dataDir }),
      observabilityStore,
      timeoutMs: 5_000,
      pumpIntervalMs: 1,
    });

    const result = await service.run({
      ...buildTask("override-approved-run", workspaceId),
      budgetOverride: {
        reason: "Approved by duty engineer for incident mitigation.",
        actorId: "operator-override",
      },
    });

    expect(result.status).toBe("completed");
    const decisions = await observabilityStore.query({ kind: "budget_decision", workspaceId }) as BudgetDecisionV0[];
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.behavior).toBe("require_override");
    expect(decisions[0]?.overrideRequired).toBe(false);
    expect(decisions[0]?.reason).toContain("Governed override applied");
    expect(decisions[0]?.audit.actorId).toBe("operator-override");
  });

  it("covers future schedule and integration scopes as fixtures without new product hooks", async () => {
    const observabilityStore = new ObservabilityStore({ dataDir });
    await observabilityStore.put(makeBudget({
      id: "budget-schedule",
      workspaceId: "fixture-workspace",
      scopeRef: { kind: "schedule", id: "nightly" },
      defaultBehavior: "block",
      thresholds: [{ metricKey: "token.output", limit: 100, behavior: "block" }],
    }));

    const fixtureDecisions = await observabilityStore.query({ kind: "budget" });
    expect(fixtureDecisions[0]?.kind).toBe("budget");
    expect((fixtureDecisions[0] as BudgetV0).scopeRef).toEqual({ kind: "schedule", id: "nightly" });
  });
});

function buildTask(id: string, workspacePath: string): TeamTask {
  return {
    id,
    title: `Budget test ${id}`,
    prompt: "Produce a budget test artifact.",
    workspacePath,
    minWorkers: 2,
  };
}

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
