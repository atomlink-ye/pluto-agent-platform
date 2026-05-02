import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  AdapterHealthSummaryV0,
  AlertV0,
  BudgetDecisionV0,
  RunHealthSummaryV0,
  UsageMeterV0,
} from "@/contracts/observability.js";
import { toImmutableEvidencePacketMetadataV0 } from "@/contracts/evidence-graph.js";
import { EvidenceGraphStore } from "@/evidence/evidence-graph.js";
import { ObservabilityStore } from "@/observability/observability-store.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-observability-cli-test-"));
  dataDir = join(workDir, ".pluto");

  const store = new ObservabilityStore({ dataDir });
  const evidenceStore = new EvidenceGraphStore({ dataDir });
  await store.put(makeRunHealthRecord({
    id: "run-health-1",
    runId: "run-1",
    status: "blocked",
    blockerReason: "runtime_timeout",
    governanceReady: true,
    readiness: { governanceReady: true, ingestionOk: true },
  }));
  await store.put(makeRunHealthRecord({
    id: "run-health-2",
    runId: "run-2",
    status: "blocked",
    blockerReason: "runtime_timeout",
    evidenceRefs: ["evidence:heuristic-only"],
    traceRef: { kind: "redacted_trace", id: "trace-2" },
  }));
  await evidenceStore.putSealedEvidenceRef({
    id: "sealed-1",
    runId: "run-1",
    evidencePath: ".pluto/runs/run-1/evidence.json",
    sealChecksum: "sha256:sealed-1",
    sealedAt: "2026-04-30T00:00:03.000Z",
    sourceRun: {
      runId: "run-1",
      status: "done",
      blockerReason: null,
      finishedAt: "2026-04-30T00:00:02.000Z",
    },
    validationSummary: { outcome: "pass", reason: null },
    redactionSummary: {
      redactedAt: "2026-04-30T00:00:02.500Z",
      fieldsRedacted: 2,
      summary: "Redacted secrets before sealing.",
    },
    immutablePacket: toImmutableEvidencePacketMetadataV0({
      schemaVersion: 0,
      status: "done",
      blockerReason: null,
      startedAt: "2026-04-30T00:00:00.000Z",
      finishedAt: "2026-04-30T00:00:02.000Z",
      generatedAt: "2026-04-30T00:00:02.500Z",
      classifierVersion: 0,
      workers: [{
        role: "lead",
        sessionId: null,
        contributionSummary: "Prepared evidence packet.",
        tokenUsageApprox: null,
        durationMsApprox: null,
      }],
      validation: { outcome: "pass", reason: null },
    }) as ReturnType<typeof toImmutableEvidencePacketMetadataV0> & Record<string, unknown>,
  });
  await store.put(makeAdapterHealthRecord({ id: "adapter-health-1", adapterKind: "paseo-opencode", status: "degraded", severity: "warn" }));
  await store.put(makeAlertRecord({ id: "alert-1", lifecycle: "triggered", severity: "critical" }));
  await store.put(makeUsageRecord({ id: "usage-1", meterKey: "token.output", quantity: 128, unit: "tokens" }));
  await store.put(makeBudgetDecisionRecord({ id: "decision-1", behavior: "require_override", reason: "Budget nearly exhausted." }));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("pnpm observability", () => {
  it("lists run health in json mode", async () => {
    const result = await runCli(["run-health", "--json"]);
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.schemaVersion).toBe(0);
    expect(output.items).toHaveLength(2);
    expect(output.items.map((item: { runId: string }) => item.runId)).toEqual(["run-1", "run-2"]);
  });

  it("filters adapter health in text mode", async () => {
    const result = await runCli(["adapter-health", "--adapter", "paseo-opencode"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("adapter-health-1");
    expect(result.stdout).toContain("paseo-opencode");
  });

  it("computes evidence readiness from stored run health summaries", async () => {
    const result = await runCli(["evidence-readiness", "--json"]);
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.items).toEqual([
      {
        schemaVersion: 0,
        runId: "run-1",
        status: "blocked",
        packetStatus: "done",
        validationOutcome: "pass",
        sealed: true,
        redacted: true,
        governanceReady: true,
        ingestionOk: true,
        readiness: "ready",
        ready: true,
      },
      {
        schemaVersion: 0,
        runId: "run-2",
        status: "blocked",
        packetStatus: null,
        validationOutcome: null,
        sealed: false,
        redacted: false,
        governanceReady: null,
        ingestionOk: null,
        readiness: "blocked",
        ready: false,
      },
    ]);
  });

  it("lists alerts, usage, and budget decisions from stored records", async () => {
    const alerts = await runCli(["alerts", "--lifecycle", "triggered", "--json"]);
    expect(alerts.exitCode).toBe(0);
    expect(JSON.parse(alerts.stdout).items.map((item: { id: string }) => item.id)).toEqual(["alert-1"]);

    const usage = await runCli(["usage", "--json"]);
    expect(usage.exitCode).toBe(0);
    expect(JSON.parse(usage.stdout).items.map((item: { id: string }) => item.id)).toEqual(["usage-1"]);

    const decisions = await runCli(["budget-decisions", "--behavior", "require_override", "--json"]);
    expect(decisions.exitCode).toBe(0);
    expect(JSON.parse(decisions.stdout).items.map((item: { id: string }) => item.id)).toEqual(["decision-1"]);
  });
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/observability.ts"), ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PLUTO_DATA_DIR: dataDir },
      timeout: 20_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: unknown) {
    const result = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.code ?? 1 };
  }
}

function makeRunHealthRecord(overrides: Record<string, unknown>): RunHealthSummaryV0 {
  return {
    schema: "pluto.observability.run-health-summary",
    schemaVersion: 0,
    kind: "run_health_summary",
    id: "run-health-default",
    workspaceId: "workspace-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    audit: baseAudit("audit-run-default", "corr-run-default"),
    runId: "run-default",
    status: "running",
    severity: "warn",
    blockerReason: null,
    summary: "Run summary",
    traceRef: null,
    evidenceRefs: [],
    observedAt: "2026-04-30T00:00:02.000Z",
    ...overrides,
  } as unknown as RunHealthSummaryV0;
}

function makeAdapterHealthRecord(overrides: Record<string, unknown>): AdapterHealthSummaryV0 {
  return {
    schema: "pluto.observability.adapter-health-summary",
    schemaVersion: 0,
    kind: "adapter_health_summary",
    id: "adapter-default",
    workspaceId: "workspace-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    audit: baseAudit("audit-adapter-default", "corr-adapter-default"),
    adapterId: "adapter-1",
    adapterKind: "fake",
    status: "healthy",
    severity: "info",
    summary: "Adapter health",
    observedAt: "2026-04-30T00:00:02.000Z",
    ...overrides,
  } as unknown as AdapterHealthSummaryV0;
}

function makeAlertRecord(overrides: Record<string, unknown>): AlertV0 {
  return {
    schema: "pluto.observability.alert",
    schemaVersion: 0,
    kind: "alert",
    id: "alert-default",
    workspaceId: "workspace-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    audit: baseAudit("audit-alert-default", "corr-alert-default"),
    alertKey: "run.errors",
    lifecycle: "armed",
    severity: "warn",
    sourceRef: null,
    summary: "Alert summary",
    firstObservedAt: "2026-04-30T00:00:00.000Z",
    lastObservedAt: "2026-04-30T00:00:01.000Z",
    acknowledgedAt: null,
    resolvedAt: null,
    ...overrides,
  } as unknown as AlertV0;
}

function makeUsageRecord(overrides: Record<string, unknown>): UsageMeterV0 {
  return {
    schema: "pluto.observability.usage-meter",
    schemaVersion: 0,
    kind: "usage_meter",
    id: "usage-default",
    workspaceId: "workspace-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    audit: baseAudit("audit-usage-default", "corr-usage-default"),
    meterKey: "token.input",
    subjectRef: { kind: "run_health_summary", id: "run-1" },
    quantity: 64,
    unit: "tokens",
    window: { unit: "hour", value: 1 },
    measuredAt: "2026-04-30T00:00:02.000Z",
    ...overrides,
  } as unknown as UsageMeterV0;
}

function makeBudgetDecisionRecord(overrides: Record<string, unknown>): BudgetDecisionV0 {
  return {
    schema: "pluto.observability.budget-decision",
    schemaVersion: 0,
    kind: "budget_decision",
    id: "decision-default",
    workspaceId: "workspace-1",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    audit: baseAudit("audit-decision-default", "corr-decision-default"),
    budgetId: "budget-1",
    snapshotId: "snapshot-1",
    subjectRef: { kind: "run_health_summary", id: "run-1" },
    behavior: "warn",
    overrideRequired: false,
    reason: "Budget decision",
    decidedAt: "2026-04-30T00:00:02.000Z",
    ...overrides,
  } as unknown as BudgetDecisionV0;
}

function baseAudit(eventId: string, correlationId: string) {
  return {
    eventId,
    eventType: "observability.recorded",
    recordedAt: "2026-04-30T00:00:00.000Z",
    correlationId,
    actorId: "user-1",
    principalId: "svc-1",
    action: "observability.capture",
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
