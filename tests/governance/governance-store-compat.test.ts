import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GovernanceStore } from "@/governance/governance-store.js";
import { RunStore } from "@/orchestrator/run-store.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-governance-compat-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("GovernanceStore compatibility with legacy run storage", () => {
  it("keeps existing .pluto/runs data readable without migration", async () => {
    const runStore = new RunStore({ dataDir });
    const governanceStore = new GovernanceStore({ dataDir });
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

    await governanceStore.put("document", {
      schemaVersion: 0,
      kind: "document",
      id: "doc-1",
      workspaceId: "workspace-1",
      title: "Governed document",
      ownerId: "owner-1",
      createdAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:01.000Z",
      status: "draft",
      currentVersionId: null,
    });

    const meta = await runStore.readRunMeta(runId);
    expect(meta).not.toBeNull();
    expect(meta).toMatchObject({
      runId,
      taskTitle: "Legacy run",
      status: "done",
      artifactPresent: true,
      evidencePresent: false,
    });
    expect(await runStore.readArtifact(runId)).toBe("# Legacy artifact\n");

    const runEventsRaw = await readFile(join(dataDir, "runs", runId, "events.jsonl"), "utf8");
    expect(runEventsRaw).toContain('"runId":"legacy-run-1"');
    expect(await governanceStore.exists("document", "doc-1")).toBe(true);
  });
});
