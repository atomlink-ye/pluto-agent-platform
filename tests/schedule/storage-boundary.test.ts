import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileScheduleStore } from "@/schedule/schedule-store.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-schedule-boundary-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("schedule storage boundary", () => {
  it("keeps backing paths as a private implementation detail", async () => {
    const store = createFileScheduleStore({ dataDir });

    const schedule = await store.put("schedule", {
      schemaVersion: 0,
      kind: "schedule",
      id: "schedule-1",
      workspaceId: "workspace-1",
      playbookId: "playbook-1",
      scenarioId: "scenario-1",
      ownerId: "owner-1",
      cadence: "0 9 * * 1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      status: "active",
    });

    const fireRecord = await store.put("fire_record", {
      schemaVersion: 0,
      kind: "fire_record",
      id: "fire-1",
      workspaceId: "workspace-1",
      scheduleId: "schedule-1",
      triggerId: null,
      runId: null,
      firedAt: "2026-04-30T00:10:00.000Z",
      createdAt: "2026-04-30T00:10:00.000Z",
      updatedAt: "2026-04-30T00:10:00.000Z",
      status: "queued",
    });

    expect(JSON.stringify(schedule)).not.toContain(dataDir);
    expect(JSON.stringify(fireRecord)).not.toContain(dataDir);
    expect(JSON.stringify(await store.listKinds())).not.toContain(".pluto/schedule");

    const updatedFireRecord = await store.update("fire_record", "fire-1", {
      updatedAt: "2026-04-30T00:11:00.000Z",
      status: "succeeded",
      runId: "run-1",
    });

    expect(JSON.stringify(updatedFireRecord)).not.toContain(dataDir);
    expect(Object.keys(updatedFireRecord ?? {})).not.toContain("path");

    expect(await readdir(join(dataDir, "schedule", "local-v0", "schedule"))).toEqual(["schedule-1.json"]);
    expect(await readdir(join(dataDir, "schedule", "local-v0", "fire-records", "fire_record"))).toEqual([
      "fire-1.json",
    ]);

    expect(
      JSON.parse(await readFile(join(dataDir, "schedule", "local-v0", "schedule", "schedule-1.json"), "utf8")),
    ).toMatchObject({ id: "schedule-1", kind: "schedule" });
  });
});
