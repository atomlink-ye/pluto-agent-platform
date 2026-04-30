import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import { DEFAULT_TEAM } from "@/orchestrator/team-config.js";
import { RunStore } from "@/orchestrator/run-store.js";
import { TeamRunService } from "@/orchestrator/team-run-service.js";
import type {
  RunsListOutputV0,
  RunsShowOutputV0,
  RunsEventV0,
  EvidencePacketV0,
} from "@/contracts/types.js";

const exec = promisify(execFile);

let workDir: string;
let dataDir: string;
let runId: string;

async function runCli(args: string[], env?: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await exec(
      "npx", ["tsx", join(process.cwd(), "src/cli/runs.ts"), ...args],
      {
        cwd: process.cwd(),
        env: { ...process.env, PLUTO_DATA_DIR: dataDir, ...env },
        timeout: 10_000,
      },
    );
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
    };
  }
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pluto-cli-test-"));
  dataDir = join(workDir, ".pluto");

  let idSeq = 0;
  const nextId = () => `cli-test-id-${String(idSeq++).padStart(4, "0")}`;
  const fixedClock = () => new Date("2026-04-29T12:00:00.000Z");

  const adapter = new FakeAdapter({ team: DEFAULT_TEAM, idGen: nextId, clock: fixedClock });
  const store = new RunStore({ dataDir });
  const service = new TeamRunService({
    adapter,
    team: DEFAULT_TEAM,
    store,
    idGen: nextId,
    clock: fixedClock,
    pumpIntervalMs: 1,
    timeoutMs: 5_000,
  });

  const result = await service.run({
    id: "cli-test-task",
    title: "CLI test task",
    prompt: "Produce a test artifact for CLI testing",
    workspacePath: workDir,
    minWorkers: 2,
  });

  runId = result.runId;
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("pnpm runs list", () => {
  it("lists runs in text mode", async () => {
    const { stdout, exitCode } = await runCli(["list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(runId);
  });

  it("lists runs in JSON mode matching RunsListOutputV0", async () => {
    const { stdout, exitCode } = await runCli(["list", "--json"]);
    expect(exitCode).toBe(0);
    const output: RunsListOutputV0 = JSON.parse(stdout);
    expect(output.schemaVersion).toBe(0);
    expect(Array.isArray(output.items)).toBe(true);
    expect(output.items.length).toBeGreaterThanOrEqual(1);

    const item = output.items[0]!;
    expect(item.schemaVersion).toBe(0);
    expect(typeof item.runId).toBe("string");
    expect(typeof item.taskTitle).toBe("string");
    expect(["queued", "running", "blocked", "failed", "done"]).toContain(item.status);
    expect(typeof item.startedAt).toBe("string");
    expect(typeof item.workerCount).toBe("number");
    expect(typeof item.artifactPresent).toBe("boolean");
    expect(typeof item.evidencePresent).toBe("boolean");
  });
});

describe("pnpm runs show", () => {
  it("shows run metadata in JSON mode matching RunsShowOutputV0", async () => {
    const { stdout, exitCode } = await runCli(["show", runId, "--json"]);
    expect(exitCode).toBe(0);
    const output: RunsShowOutputV0 = JSON.parse(stdout);
    expect(output.schemaVersion).toBe(0);
    expect(output.runId).toBe(runId);
    expect(output.taskTitle).toBe("CLI test task");
    expect(output.workspace).toBe("[REDACTED:workspace-path]");
    expect(typeof output.taskTitle).toBe("string");
    expect(["queued", "running", "blocked", "failed", "done"]).toContain(output.status);
    expect(Array.isArray(output.workers)).toBe(true);
  });

  it("shows run in text mode", async () => {
    const { stdout, exitCode } = await runCli(["show", runId]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Run:");
    expect(stdout).toContain(runId);
  });

  it("prints blocker reason and message in text mode", async () => {
    const blockedRunId = "blocked-cli-run";
    const blockedRunDir = join(dataDir, "runs", blockedRunId);
    await mkdir(blockedRunDir, { recursive: true });
    await writeFile(
      join(blockedRunDir, "events.jsonl"),
      [
        { id: "b1", runId: blockedRunId, ts: "2026-04-29T12:00:00.000Z", type: "run_started", payload: { title: "Blocked CLI", taskId: "blocked" } },
        { id: "b2", runId: blockedRunId, ts: "2026-04-29T12:00:01.000Z", type: "blocker", payload: { reason: "validation_failed", message: "evaluator rejected artifact" } },
        { id: "b3", runId: blockedRunId, ts: "2026-04-29T12:00:02.000Z", type: "run_failed", payload: { message: "Blocker: validation_failed" } },
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
      "utf8",
    );

    const { stdout, exitCode } = await runCli(["show", blockedRunId]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Blocker: validation_failed — evaluator rejected artifact");
  });

  it("normalizes legacy blocker reasons in list/show output", async () => {
    const blockedRunId = "legacy-blocked-cli-run";
    const blockedRunDir = join(dataDir, "runs", blockedRunId);
    await mkdir(blockedRunDir, { recursive: true });
    await writeFile(
      join(blockedRunDir, "events.jsonl"),
      [
        { id: "lb1", runId: blockedRunId, ts: "2026-04-29T12:00:00.000Z", type: "run_started", payload: { title: "Legacy Blocked", taskId: "legacy" } },
        { id: "lb2", runId: blockedRunId, ts: "2026-04-29T12:00:01.000Z", type: "blocker", payload: { reason: "worker_timeout", message: "worker timed_out" } },
        { id: "lb3", runId: blockedRunId, ts: "2026-04-29T12:00:02.000Z", type: "run_failed", payload: { message: "Blocker: worker_timeout" } },
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
      "utf8",
    );

    const { stdout: listOut, exitCode: listExit } = await runCli(["list", "--json"]);
    expect(listExit).toBe(0);
    const listOutput: RunsListOutputV0 = JSON.parse(listOut);
    expect(listOutput.items.find((i) => i.runId === blockedRunId)?.blockerReason).toBe("runtime_timeout");

    const { stdout: showOut, exitCode: showExit } = await runCli(["show", blockedRunId]);
    expect(showExit).toBe(0);
    expect(showOut).toContain("Blocker: runtime_timeout — worker timed_out");
    expect(showOut).not.toContain("worker_timeout");
  });
});

describe("pnpm runs events", () => {
  it("lists events in JSON mode matching RunsEventV0", async () => {
    const { stdout, exitCode } = await runCli(["events", runId, "--json"]);
    expect(exitCode).toBe(0);
    const events: RunsEventV0[] = JSON.parse(stdout);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);

    const ev = events[0]!;
    expect(ev.schemaVersion).toBe(0);
    expect(typeof ev.eventId).toBe("string");
    expect(typeof ev.occurredAt).toBe("string");
    expect(typeof ev.kind).toBe("string");
    expect(typeof ev.attempt).toBe("number");
  });

  it("redacts secret-shaped event payloads in RunStore and CLI JSON output", async () => {
    const secretRunId = "secret-payload-run";
    const secretRunDir = join(dataDir, "runs", secretRunId);
    const rawSecret = "sk-ant-api03-abcdefghijklmnop";
    await mkdir(secretRunDir, { recursive: true });
    await writeFile(
      join(secretRunDir, "events.jsonl"),
      JSON.stringify({
        id: "secret-e1",
        runId: secretRunId,
        ts: "2026-04-29T12:00:00.000Z",
        type: "lead_message",
        payload: { message: `token ${rawSecret}`, nested: { apiKey: rawSecret } },
      }) + "\n",
      "utf8",
    );

    const store = new RunStore({ dataDir });
    const readEvents: RunsEventV0[] = [];
    for await (const event of store.readEventsJSONL(secretRunId)) readEvents.push(event);
    expect(JSON.stringify(readEvents)).not.toContain(rawSecret);
    expect(JSON.stringify(readEvents)).toContain("[REDACTED]");

    const { stdout, exitCode } = await runCli(["events", secretRunId, "--json"]);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain(rawSecret);
    expect(stdout).toContain("[REDACTED]");
  });

  it("normalizes legacy blocker reasons in events JSON output", async () => {
    const legacyRunId = "legacy-events-run";
    const legacyRunDir = join(dataDir, "runs", legacyRunId);
    await mkdir(legacyRunDir, { recursive: true });
    await writeFile(
      join(legacyRunDir, "events.jsonl"),
      JSON.stringify({
        id: "legacy-e1",
        runId: legacyRunId,
        ts: "2026-04-29T12:00:00.000Z",
        type: "blocker",
        payload: { reason: "quota_or_model_error", message: "429 rate limit exceeded" },
      }) + "\n",
      "utf8",
    );

    const { stdout, exitCode } = await runCli(["events", legacyRunId, "--json"]);
    expect(exitCode).toBe(0);
    const events: RunsEventV0[] = JSON.parse(stdout);
    expect((events[0]!.payload as { reason?: string }).reason).toBe("quota_exceeded");
  });

  it("prints newline-delimited JSON events in --follow --json mode", async () => {
    const { stdout, exitCode } = await runCli(["events", runId, "--follow", "--json"]);
    expect(exitCode).toBe(0);
    const lines = stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const ev: RunsEventV0 = JSON.parse(line);
      expect(ev.schemaVersion).toBe(0);
      expect(ev.runId).toBe(runId);
    }
    expect(() => JSON.parse(stdout)).toThrow();
  });

  it("filters --since by event id and emits events after the matched id", async () => {
    const { stdout } = await runCli(["events", runId, "--json"]);
    const events: RunsEventV0[] = JSON.parse(stdout);
    expect(events.length).toBeGreaterThan(2);
    const sinceEvent = events[1]!;

    const { stdout: filteredOut, exitCode } = await runCli(["events", runId, "--since", sinceEvent.eventId, "--json"]);
    expect(exitCode).toBe(0);
    const filtered: RunsEventV0[] = JSON.parse(filteredOut);
    expect(filtered.map((ev) => ev.eventId)).toEqual(events.slice(2).map((ev) => ev.eventId));
    expect(filtered.some((ev) => ev.eventId === sinceEvent.eventId)).toBe(false);
  });

  it("filters --since ISO timestamps strictly after that timestamp", async () => {
    const timestampRunId = "timestamp-cli-run";
    const timestampRunDir = join(dataDir, "runs", timestampRunId);
    await mkdir(timestampRunDir, { recursive: true });
    await writeFile(
      join(timestampRunDir, "events.jsonl"),
      [
        { id: "t1", runId: timestampRunId, ts: "2026-04-29T12:00:00.000Z", type: "run_started", payload: {} },
        { id: "t2", runId: timestampRunId, ts: "2026-04-29T12:00:01.000Z", type: "worker_started", roleId: "planner", payload: {} },
        { id: "t3", runId: timestampRunId, ts: "2026-04-29T12:00:02.000Z", type: "run_completed", payload: {} },
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
      "utf8",
    );

    const { stdout, exitCode } = await runCli(["events", timestampRunId, "--since", "2026-04-29T12:00:01.000Z", "--json"]);
    expect(exitCode).toBe(0);
    const filtered: RunsEventV0[] = JSON.parse(stdout);
    expect(filtered.map((ev) => ev.eventId)).toEqual(["t3"]);
  });

  it("rejects unknown --role value with non-zero exit", async () => {
    const { exitCode, stderr } = await runCli(["events", runId, "--role", "unknown_role"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Unknown role");
  });

  it("rejects unknown --kind value with non-zero exit", async () => {
    const { exitCode, stderr } = await runCli(["events", runId, "--kind", "unknown_kind"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Unknown kind");
  });
});

describe("pnpm runs artifact", () => {
  it("prints artifact markdown", async () => {
    const { stdout, exitCode } = await runCli(["artifact", runId]);
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout).toContain("planner");
  });
});

describe("pnpm runs evidence", () => {
  it("prints evidence markdown by default", async () => {
    const { stdout, exitCode } = await runCli(["evidence", runId]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Evidence Packet");
  });

  it("prints validated EvidencePacketV0 in JSON mode", async () => {
    const { stdout, exitCode } = await runCli(["evidence", runId, "--json"]);
    expect(exitCode).toBe(0);
    const packet: EvidencePacketV0 = JSON.parse(stdout);
    expect(packet.schemaVersion).toBe(0);
    expect(typeof packet.runId).toBe("string");
    expect(typeof packet.taskTitle).toBe("string");
    expect(["done", "blocked", "failed"]).toContain(packet.status);
    expect(typeof packet.startedAt).toBe("string");
    expect(typeof packet.finishedAt).toBe("string");
    expect(Array.isArray(packet.workers)).toBe(true);
    expect(packet.classifierVersion).toBe(0);
  });

  it("normalizes legacy blocker reasons in evidence JSON and markdown output", async () => {
    const legacyRunId = "legacy-evidence-run";
    const legacyRunDir = join(dataDir, "runs", legacyRunId);
    await mkdir(legacyRunDir, { recursive: true });
    await writeFile(
      join(legacyRunDir, "events.jsonl"),
      [
        { id: "le1", runId: legacyRunId, ts: "2026-04-29T12:00:00.000Z", type: "run_started", payload: { title: "Legacy Evidence" } },
        { id: "le2", runId: legacyRunId, ts: "2026-04-29T12:00:01.000Z", type: "run_failed", payload: { message: "Blocker: worker_timeout" } },
      ].map((event) => JSON.stringify(event)).join("\n") + "\n",
      "utf8",
    );
    const legacyPacket = {
      schemaVersion: 0,
      runId: legacyRunId,
      taskTitle: "Legacy Evidence",
      status: "blocked",
      blockerReason: "worker_timeout",
      startedAt: "2026-04-29T12:00:00.000Z",
      finishedAt: "2026-04-29T12:00:01.000Z",
      workspace: null,
      workers: [],
      validation: { outcome: "na", reason: null },
      citedInputs: { taskPrompt: "legacy", workspaceMarkers: [] },
      risks: [],
      openQuestions: [],
      classifierVersion: 0,
      generatedAt: "2026-04-29T12:00:01.000Z",
    };
    await writeFile(join(legacyRunDir, "evidence.json"), JSON.stringify(legacyPacket, null, 2), "utf8");
    await writeFile(join(legacyRunDir, "evidence.md"), "- **Blocker:** worker_timeout\n", "utf8");

    const { stdout: jsonOut, exitCode: jsonExit } = await runCli(["evidence", legacyRunId, "--json"]);
    expect(jsonExit).toBe(0);
    expect((JSON.parse(jsonOut) as EvidencePacketV0).blockerReason).toBe("runtime_timeout");

    const { stdout: mdOut, exitCode: mdExit } = await runCli(["evidence", legacyRunId]);
    expect(mdExit).toBe(0);
    expect(mdOut).toContain("**Blocker:** runtime_timeout");
    expect(mdOut).not.toContain("worker_timeout");
  });
});

describe("old run (pre-MVP-beta) degraded behavior", () => {
  it("lists old run with evidencePresent=false", async () => {
    const oldRunId = "old-mvp-alpha-run";
    const oldRunDir = join(dataDir, "runs", oldRunId);
    await mkdir(oldRunDir, { recursive: true });
    await writeFile(
      join(oldRunDir, "events.jsonl"),
      JSON.stringify({
        id: "old-e1",
        runId: oldRunId,
        ts: "2026-04-20T00:00:00.000Z",
        type: "run_started",
        payload: { taskId: "old-task", prompt: "old task" },
      }) + "\n" +
      JSON.stringify({
        id: "old-e2",
        runId: oldRunId,
        ts: "2026-04-20T00:01:00.000Z",
        type: "run_completed",
        payload: { workerCount: 2 },
      }) + "\n",
      "utf8",
    );
    await writeFile(join(oldRunDir, "artifact.md"), "# Old artifact\nContent", "utf8");

    const { stdout: listOut, exitCode: listExit } = await runCli(["list", "--json"]);
    expect(listExit).toBe(0);
    const listOutput: RunsListOutputV0 = JSON.parse(listOut);
    const oldItem = listOutput.items.find((i) => i.runId === oldRunId);
    expect(oldItem).toBeDefined();
    expect(oldItem!.evidencePresent).toBe(false);

    const { stdout: evidenceOut, exitCode: evidenceExit } = await runCli(["evidence", oldRunId]);
    expect(evidenceExit).toBe(0);
    expect(evidenceOut).toContain("No evidence packet for this run (pre-MVP-beta run)");
  });
});
