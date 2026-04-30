import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunStore } from "@/orchestrator/run-store.js";
import { createFileScheduleStore } from "@/schedule/schedule-store.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-run-compat-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("ScheduleStore compatibility with legacy run storage", () => {
  it("keeps .pluto/runs history readable and isolated from schedule persistence", async () => {
    const runStore = new RunStore({ dataDir });
    const scheduleStore = createFileScheduleStore({ dataDir });
    const runId = "legacy-run-1";

    await runStore.ensure(runId);
    await writeFile(
      join(dataDir, "runs", runId, "events.jsonl"),
      [
        JSON.stringify({
          id: "start-1",
          runId,
          ts: "2026-04-30T00:00:00.000Z",
          type: "run_started",
          payload: { title: "Legacy run" },
        }),
        JSON.stringify({
          id: "done-1",
          runId,
          ts: "2026-04-30T00:00:03.000Z",
          type: "run_completed",
          payload: {},
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    await writeFile(join(dataDir, "runs", runId, "artifact.md"), "# Legacy artifact\n", "utf8");

    await scheduleStore.put("schedule", {
      schemaVersion: 0,
      kind: "schedule",
      id: "schedule-1",
      workspaceId: "workspace-1",
      playbookId: "playbook-1",
      scenarioId: "scenario-1",
      ownerId: "owner-1",
      cadence: "0 9 * * 1",
      createdAt: "2026-04-30T00:05:00.000Z",
      updatedAt: "2026-04-30T00:05:01.000Z",
      status: "active",
    });
    await scheduleStore.put("fire_record", {
      schemaVersion: 0,
      kind: "fire_record",
      id: "fire-1",
      workspaceId: "workspace-1",
      scheduleId: "schedule-1",
      triggerId: null,
      runId,
      firedAt: "2026-04-30T00:10:00.000Z",
      createdAt: "2026-04-30T00:10:00.000Z",
      updatedAt: "2026-04-30T00:10:00.000Z",
      status: "succeeded",
    });

    await expect(runStore.readRunMeta(runId)).resolves.toMatchObject({
      runId,
      taskTitle: "Legacy run",
      status: "done",
      artifactPresent: true,
      evidencePresent: false,
    });
    await expect(runStore.readArtifact(runId)).resolves.toBe("# Legacy artifact\n");
    await expect(runStore.listRunDirs()).resolves.toEqual([runId]);

    await expect(scheduleStore.get("schedule", "schedule-1")).resolves.toMatchObject({ id: "schedule-1" });
    await expect(scheduleStore.list("fire_record")).resolves.toMatchObject([{ runId }]);

    const runEventsRaw = await readFile(join(dataDir, "runs", runId, "events.jsonl"), "utf8");
    expect(runEventsRaw).toContain('"runId":"legacy-run-1"');
  });
});
