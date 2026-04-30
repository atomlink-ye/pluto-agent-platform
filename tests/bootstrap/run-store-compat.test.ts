import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BootstrapSessionV0 } from "@/bootstrap/index.js";
import { BootstrapStore } from "@/bootstrap/index.js";
import { RunStore } from "@/orchestrator/run-store.js";

let dataDir: string;

const workspaceRef = {
  workspaceId: "workspace-legacy-1",
  kind: "workspace",
  id: "workspace-legacy-1",
} as const;

const actorRef = {
  workspaceId: "workspace-legacy-1",
  kind: "user",
  principalId: "user-legacy-1",
} as const;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "pluto-bootstrap-run-compat-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function makeSessionRecord(): BootstrapSessionV0 {
  return {
    schema: "pluto.bootstrap.session",
    schemaVersion: 0,
    id: "session-legacy-1",
    workspaceRef,
    actorRefs: [actorRef],
    status: "running",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
    startedAt: "2026-04-30T00:00:00.000Z",
    finishedAt: null,
    blockingReason: null,
    resolutionHint: null,
    stepIds: [],
    createdObjectRefs: [],
  };
}

describe("BootstrapStore compatibility with existing run storage", () => {
  it("keeps existing .pluto/runs data readable without migration", async () => {
    const runStore = new RunStore({ dataDir });
    const bootstrapStore = new BootstrapStore({ dataDir });
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

    await bootstrapStore.putSession(makeSessionRecord());

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
    const bootstrapSessionRaw = await readFile(
      join(dataDir, "bootstrap", "workspace-legacy-1", "sessions", "session-legacy-1", "session.json"),
      "utf8",
    );

    expect(runEventsRaw).toContain('"runId":"legacy-run-1"');
    expect(JSON.parse(bootstrapSessionRaw)).toMatchObject({
      schema: "pluto.bootstrap.session",
      id: "session-legacy-1",
    });
    expect(bootstrapSessionRaw).not.toContain("# Legacy artifact");
  });
});
