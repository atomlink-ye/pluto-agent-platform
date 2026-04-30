import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunStore } from "@/orchestrator/run-store.js";
import type { AgentEvent } from "@/contracts/types.js";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-run-store-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("RunStore redaction and metadata reads", () => {
  it("persists redacted payloads when appending events", async () => {
    const store = new RunStore({ dataDir: workDir });
    const runId = "run-store-redaction";
    const secret = "TOP_SECRET=top-secret-value";
    const event: AgentEvent = {
      id: "ev-1",
      runId,
      ts: "2026-04-30T00:00:00.000Z",
      type: "lead_message",
      payload: {
        message: `never persist ${secret}`,
        nested: { token: secret },
      },
    };

    await store.appendEvent(event);

    const raw = await readFile(join(workDir, "runs", runId, "events.jsonl"), "utf8");
    expect(raw).not.toContain("top-secret-value");
    expect(raw).toContain("[REDACTED]");
  });

  it("still redacts on read for legacy unredacted event logs", async () => {
    const store = new RunStore({ dataDir: workDir });
    const runId = "legacy-redaction-run";
    const runDir = join(workDir, "runs", runId);
    const secret = "sk-ant-api03-abcdefghijklmnop";

    await store.ensure(runId);
    await writeFile(
      join(runDir, "events.jsonl"),
      JSON.stringify({
        id: "legacy-1",
        runId,
        ts: "2026-04-30T00:00:00.000Z",
        type: "lead_message",
        payload: { message: `token ${secret}` },
      }) + "\n",
      "utf8",
    );

    const events = [];
    for await (const event of store.readEventsJSONL(runId)) events.push(event);

    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(events)).toContain("[REDACTED]");
  });

  it("redacts absolute path payload fields on persist and on legacy read", async () => {
    const store = new RunStore({ dataDir: workDir });
    const runId = "path-redaction-run";
    const absolutePath = join(workDir, "runs", runId, "artifact.md");

    await store.appendEvent({
      id: "path-1",
      runId,
      ts: "2026-04-30T00:00:00.000Z",
      type: "artifact_created",
      payload: { path: absolutePath, bytes: 12 },
    });

    const persisted = await readFile(join(workDir, "runs", runId, "events.jsonl"), "utf8");
    expect(persisted).not.toContain(absolutePath);
    expect(persisted).toContain("[REDACTED:path]");

    const legacyRunId = "legacy-path-redaction-run";
    await store.ensure(legacyRunId);
    await writeFile(
      join(workDir, "runs", legacyRunId, "events.jsonl"),
      JSON.stringify({
        id: "legacy-path-1",
        runId: legacyRunId,
        ts: "2026-04-30T00:00:00.000Z",
        type: "artifact_created",
        payload: { path: absolutePath, bytes: 12 },
      }) + "\n",
      "utf8",
    );

    const events = [];
    for await (const event of store.readEventsJSONL(legacyRunId)) events.push(event);
    expect(JSON.stringify(events)).not.toContain(absolutePath);
    expect(JSON.stringify(events)).toContain("[REDACTED:path]");
  });

  it("persists redacted artifacts and re-redacts legacy artifact reads", async () => {
    const store = new RunStore({ dataDir: workDir });
    const runId = "artifact-redaction-run";
    const secret = "ARTIFACT_SECRET=artifact-secret-value";

    await store.writeArtifact({
      runId,
      markdown: `# Artifact\ncontains ${secret}`,
      leadSummary: "Artifact",
      contributions: [],
    });

    const persisted = await readFile(join(workDir, "runs", runId, "artifact.md"), "utf8");
    expect(persisted).not.toContain("artifact-secret-value");
    expect(persisted).toContain("[REDACTED]");
    expect(await store.readArtifact(runId)).toBe(persisted);

    const legacyRunId = "legacy-artifact-redaction-run";
    await store.ensure(legacyRunId);
    await writeFile(
      join(workDir, "runs", legacyRunId, "artifact.md"),
      `# Legacy\ncontains ${secret}`,
      "utf8",
    );

    const legacyArtifact = await store.readArtifact(legacyRunId);
    expect(legacyArtifact).not.toContain("artifact-secret-value");
    expect(legacyArtifact).toContain("[REDACTED]");
  });

  it("skips corrupt JSONL lines when reading run metadata", async () => {
    const store = new RunStore({ dataDir: workDir });
    const runId = "corrupt-jsonl-run";
    const runDir = join(workDir, "runs", runId);

    await store.ensure(runId);
    await writeFile(
      join(runDir, "events.jsonl"),
      [
        JSON.stringify({
          id: "start-1",
          runId,
          ts: "2026-04-30T00:00:00.000Z",
          type: "run_started",
          payload: { title: "Corrupt metadata run" },
        }),
        "{not-json",
        JSON.stringify({
          id: "done-1",
          runId,
          ts: "2026-04-30T00:00:02.000Z",
          type: "run_completed",
          payload: { workerCount: 2 },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const meta = await store.readRunMeta(runId);

    expect(meta).not.toBeNull();
    expect(meta?.taskTitle).toBe("Corrupt metadata run");
    expect(meta?.status).toBe("done");
    expect(meta?.startedAt).toBe("2026-04-30T00:00:00.000Z");
    expect(meta?.finishedAt).toBe("2026-04-30T00:00:02.000Z");
    expect(meta?.parseWarnings).toBe(1);
  });
});
