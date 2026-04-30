import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ScheduleStore } from "@/schedule/schedule-store.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-schedules-cli-test-"));
  dataDir = join(workDir, ".pluto");

  const scheduleStore = new ScheduleStore({ dataDir });
  const schedule = makeSchedule({ id: "schedule-alpha" });

  await scheduleStore.put("schedule", schedule);
  await scheduleStore.put("trigger", {
    schema: "pluto.schedule.trigger",
    schemaVersion: 0,
    kind: "trigger",
    id: "trigger-alpha",
    workspaceId: schedule.workspaceId,
    scheduleRef: schedule.id,
    triggerKind: "cron",
    status: "active",
    configRef: "cron:0 9 * * *",
    credentialRef: null,
    lastFiredAt: "2026-04-30T09:00:00.000Z",
    createdAt: schedule.createdAt,
    updatedAt: "2026-04-30T09:00:00.000Z",
    scheduleId: schedule.id,
    lastRunId: "run-alpha",
  });
  await scheduleStore.put("subscription", {
    schema: "pluto.schedule.subscription",
    schemaVersion: 0,
    kind: "subscription",
    id: "subscription-alpha",
    workspaceId: schedule.workspaceId,
    scheduleRef: schedule.id,
    triggerRef: "trigger-alpha",
    eventRef: "run_projection:run-alpha",
    deliveryRef: null,
    filterRef: null,
    status: "active",
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
    scheduleId: schedule.id,
    subscriberKind: "run_projection",
    subscriberId: "run-alpha",
  });
  await scheduleStore.put("fire_record", {
    schemaVersion: 0,
    kind: "fire_record",
    id: "fire-alpha",
    workspaceId: schedule.workspaceId,
    scheduleId: schedule.id,
    triggerId: "trigger-alpha",
    runId: "run-alpha",
    firedAt: "2026-04-30T09:00:00.000Z",
    createdAt: "2026-04-30T09:00:00.000Z",
    updatedAt: "2026-04-30T09:00:00.000Z",
    status: "queued",
  });
  await scheduleStore.put("missed_run", {
    schema: "pluto.schedule.missed-run",
    schemaVersion: 0,
    kind: "missed_run",
    id: "missed-alpha",
    workspaceId: schedule.workspaceId,
    scheduleRef: schedule.id,
    triggerRef: "trigger-alpha",
    expectedAt: "2026-04-30T08:00:00.000Z",
    status: "blocked",
    blockerReason: "policy_blocked",
    lastAttemptRunRef: null,
    recordedAt: "2026-04-30T08:05:00.000Z",
    resolvedAt: null,
    createdAt: "2026-04-30T08:05:00.000Z",
    updatedAt: "2026-04-30T08:05:00.000Z",
    scheduleId: schedule.id,
    fireRecordId: "fire-alpha",
    reason: "policy_blocked",
  });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function runSchedules(args: string[], envDataDir = dataDir): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec("npx", ["tsx", join(process.cwd(), "src/cli/schedules.ts"), ...args], {
      cwd: process.cwd(),
      env: { ...process.env, PLUTO_DATA_DIR: envDataDir },
      timeout: 10_000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", exitCode: error.code ?? 1 };
  }
}

describe("pnpm schedules", () => {
  it("lists local schedules in text and JSON modes", async () => {
    const text = await runSchedules(["list"]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("schedule-alpha");
    expect(text.stdout).toContain("0 9 * * *");

    const json = await runSchedules(["list", "--json"]);
    expect(json.exitCode).toBe(0);
    const output = JSON.parse(json.stdout) as { schemaVersion: number; items: Array<Record<string, unknown>> };
    expect(output.schemaVersion).toBe(0);
    expect(output.items).toHaveLength(1);
    expect(output.items[0]?.["scheduleRef"]).toMatchObject({ recordId: "schedule-alpha", workspaceId: "ws-local-alpha" });
    expect(output.items[0]?.["latestRunId"]).toBe("run-alpha");
  });

  it("shows schedule detail and history projections", async () => {
    const show = await runSchedules(["show", "schedule-alpha", "--json"]);
    expect(show.exitCode).toBe(0);
    const detail = JSON.parse(show.stdout) as { scheduleRef: { recordId: string }; triggerRefs: unknown[]; subscriptionRefs: unknown[]; latestHistory: unknown[] };
    expect(detail.scheduleRef.recordId).toBe("schedule-alpha");
    expect(detail.triggerRefs).toHaveLength(1);
    expect(detail.subscriptionRefs).toHaveLength(1);
    expect(detail.latestHistory).toHaveLength(2);

    const history = await runSchedules(["history", "schedule-alpha", "--json"]);
    expect(history.exitCode).toBe(0);
    const projection = JSON.parse(history.stdout) as { entries: Array<{ historyKind: string; runId: string | null; reason: string | null }> };
    expect(projection.entries.map((entry) => entry.historyKind)).toEqual(["fire_record", "missed_run"]);
    expect(projection.entries[0]?.runId).toBe("run-alpha");
    expect(projection.entries[1]?.reason).toBe("policy_blocked");
  });

  it("renders the schedules empty state when no local schedules exist", async () => {
    const emptyWorkDir = await mkdtemp(join(tmpdir(), "pluto-schedules-cli-empty-"));
    const emptyDataDir = join(emptyWorkDir, ".pluto");
    const emptyStore = new ScheduleStore({ dataDir: emptyDataDir });

    try {
      const list = await runSchedules(["list"], emptyDataDir);
      expect(list.exitCode).toBe(0);
      expect(list.stdout.trim()).toBe("No local schedules found.");

      await emptyStore.put("schedule", makeSchedule({ id: "schedule-empty", triggerRefs: [], subscriptionRefs: [] }));
      const history = await runSchedules(["history", "schedule-empty"], emptyDataDir);
      expect(history.exitCode).toBe(0);
      expect(history.stdout.trim()).toBe("No local history for schedule schedule-empty.");
    } finally {
      await rm(emptyWorkDir, { recursive: true, force: true });
    }
  });
});

function makeSchedule(overrides: Partial<ReturnType<typeof makeScheduleBase>> & Pick<ReturnType<typeof makeScheduleBase>, "id">) {
  return { ...makeScheduleBase(), ...overrides };
}

function makeScheduleBase() {
  return {
    schema: "pluto.schedule" as const,
    schemaVersion: 0 as const,
    kind: "schedule" as const,
    id: "schedule-alpha",
    workspaceId: "ws-local-alpha",
    playbookRef: "playbook:playbook-alpha",
    scenarioRef: "scenario:scenario-alpha",
    ownerRef: "user:owner-alpha",
    triggerRefs: ["trigger-alpha"],
    subscriptionRefs: ["subscription-alpha"],
    status: "active",
    nextDueAt: null,
    lastTriggeredAt: null,
    createdAt: "2026-04-30T08:00:00.000Z",
    updatedAt: "2026-04-30T08:00:00.000Z",
    playbookId: "playbook-alpha",
    scenarioId: "scenario-alpha",
    ownerId: "owner-alpha",
    cadence: "0 9 * * *",
  };
}
