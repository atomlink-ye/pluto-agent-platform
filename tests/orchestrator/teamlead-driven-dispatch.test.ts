import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import { FakeMailboxTransport } from "@/adapters/fake/fake-mailbox-transport.js";
import type { AgentEvent } from "@/contracts/types.js";
import type { MailboxEnvelope, MailboxMessage, TaskRecord, WorkerCompleteBody } from "@/contracts/four-layer.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.sequential("teamlead-driven dispatch", () => {
  it("executes the happy path through spawn_request messages", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createManualDispatchRun("happy-path");
      const tasks = await waitForTasks(run.runDir, 3);

      await driveHappyPath(run, tasks);
      const result = await run.resultPromise;
      const events = await readEvents(run.runDir);

      expect(result.run.status).toBe("succeeded");
      expect(events.some((event) => event.type === "spawn_request_executed" && event.payload["orchestrationSource"] === "teamlead_chat")).toBe(true);
      expect(events.some((event) => event.type === "worker_complete_received" && event.payload["orchestrationSource"] === "teamlead_chat")).toBe(true);
      expect(events.some((event) => event.type === "final_reconciliation_received" && event.payload["orchestrationSource"] === "teamlead_chat")).toBe(true);
      expect(events.some((event) => event.type === "mailbox_message_delivered" && event.payload["orchestrationSource"] === "teamlead_chat")).toBe(true);
    });
  });

  it("rejects a downstream spawn_request before dependencies are complete", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createManualDispatchRun("depends-on");
      const tasks = await waitForTasks(run.runDir, 3);
      const generatorTask = taskByAssignee(tasks, "generator");

      await postSpawnRequest(run, { from: "lead", targetRole: "generator", taskId: generatorTask.id });
      await waitForEvent(run.runDir, (event) =>
        event.type === "spawn_request_rejected"
        && event.payload["taskId"] === generatorTask.id
        && String(event.payload["reason"] ?? "").includes("dependsOn"),
      8_000);

      await driveHappyPath(run, tasks);
      await run.resultPromise;
    });
  });

  it("rejects spawn_request from a non-lead sender", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createManualDispatchRun("untrusted-spawn");
      const tasks = await waitForTasks(run.runDir, 3);
      const plannerTask = taskByAssignee(tasks, "planner");

      await postSpawnRequest(run, { from: "planner", targetRole: "planner", taskId: plannerTask.id });
      await waitForEvent(run.runDir, (event) =>
        event.type === "spawn_request_untrusted_sender"
        && event.payload["fromRole"] === "planner",
      );

      const eventsAfterReject = await readEvents(run.runDir);
      expect(eventsAfterReject.some((event) => event.type === "worker_started" && event.roleId === "planner")).toBe(false);

      await driveHappyPath(run, tasks);
      await run.resultPromise;
    });
  });

  it("rejects worker_complete from a role that did not claim the task", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createManualDispatchRun("untrusted-complete");
      const tasks = await waitForTasks(run.runDir, 3);
      const generatorTask = taskByAssignee(tasks, "generator");

      await postWorkerComplete(run, {
        from: "evaluator",
        taskId: generatorTask.id,
        status: "failed",
        summary: "forged",
      });
      await waitForEvent(run.runDir, (event) =>
        event.type === "worker_complete_untrusted_sender"
        && event.payload["taskId"] === generatorTask.id
        && event.payload["fromRole"] === "evaluator",
      );

      const generatorState = taskByAssignee(await readTasks(run.runDir), "generator");
      expect(generatorState.status).toBe("pending");

      await driveHappyPath(run, tasks);
      await run.resultPromise;
    });
  });

  it("keeps the legacy static loop behind PLUTO_DISPATCH_MODE=static_loop", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "static_loop" }, async () => {
      const workspace = await mkdtemp(join(tmpdir(), "pluto-static-loop-"));
      const dataDir = join(workspace, ".pluto");
      tempDirs.push(workspace);

      const result = await runManagerHarness({
        rootDir: repoRoot,
        selection: { scenario: "hello-team", runProfile: "fake-smoke" },
        workspaceOverride: workspace,
        dataDir,
        createAdapter: ({ team }) => new FakeAdapter({ team }),
      });

      const events = await readEvents(result.runDir);
      expect(result.run.status).toBe("succeeded");
      expect(events.some((event) => event.type === "task_claimed" && event.payload["orchestrationSource"] === "static_loop")).toBe(true);
      expect(events.some((event) => event.type === "spawn_request_received")).toBe(false);
    });
  });
});

class CapturingTransport extends FakeMailboxTransport {
  roomRef: string | undefined;

  override async createRoom(input: Parameters<FakeMailboxTransport["createRoom"]>[0]) {
    const room = await super.createRoom(input);
    this.roomRef = room;
    return room;
  }
}

async function createManualDispatchRun(name: string) {
  const workspace = await mkdtemp(join(tmpdir(), `pluto-teamlead-${name}-`));
  const dataDir = join(workspace, ".pluto");
  const runId = `run-${name}`;
  let idSequence = 0;
  tempDirs.push(workspace);

  const transport = new CapturingTransport();
  const resultPromise = runManagerHarness({
    rootDir: repoRoot,
    selection: { scenario: "hello-team", runProfile: "fake-smoke" },
    workspaceOverride: workspace,
    dataDir,
    idGen: () => {
      idSequence += 1;
      return idSequence === 1 ? runId : `${runId}-id-${idSequence}`;
    },
    autoDriveDispatch: false,
    createAdapter: ({ team }) => new FakeAdapter({ team }),
    createMailboxTransport: () => transport,
  });

  const runDir = join(dataDir, "runs", runId);
  await waitFor(async () => {
    await access(join(runDir, "tasks.json"));
    return Boolean(transport.roomRef);
  });

  return { dataDir, resultPromise, roomRef: transport.roomRef!, runDir, runId, transport, workspace };
}

async function driveHappyPath(
  run: Awaited<ReturnType<typeof createManualDispatchRun>>,
  tasks: TaskRecord[],
) {
  const plannerTask = taskByAssignee(tasks, "planner");
  const generatorTask = taskByAssignee(tasks, "generator");
  const evaluatorTask = taskByAssignee(tasks, "evaluator");

  await postSpawnRequest(run, { from: "lead", targetRole: "planner", taskId: plannerTask.id });
  await waitForEvent(run.runDir, (event) => event.type === "worker_complete_received" && event.payload["taskId"] === plannerTask.id);

  await postSpawnRequest(run, { from: "lead", targetRole: "generator", taskId: generatorTask.id });
  await waitForEvent(run.runDir, (event) => event.type === "worker_complete_received" && event.payload["taskId"] === generatorTask.id);

  await postSpawnRequest(run, { from: "lead", targetRole: "evaluator", taskId: evaluatorTask.id });
  await waitForEvent(run.runDir, (event) => event.type === "worker_complete_received" && event.payload["taskId"] === evaluatorTask.id);

  await postFinalReconciliation(run, [plannerTask.id, generatorTask.id, evaluatorTask.id]);
}

async function postSpawnRequest(
  run: Awaited<ReturnType<typeof createManualDispatchRun>>,
  input: { from: string; targetRole: string; taskId: string },
) {
  const message = createMailboxMessage({
    id: `${input.from}-${input.targetRole}-${input.taskId}`,
    to: "lead",
    from: input.from,
    kind: "spawn_request",
    body: {
      schemaVersion: "v1",
      targetRole: input.targetRole,
      taskId: input.taskId,
      rationale: `dispatch ${input.targetRole}`,
    },
  });
  await run.transport.post({ room: run.roomRef, envelope: buildEnvelope(run.runId, message) });
}

async function postWorkerComplete(
  run: Awaited<ReturnType<typeof createManualDispatchRun>>,
  input: { from: string; taskId: string; status: WorkerCompleteBody["status"]; summary: string },
) {
  const message = createMailboxMessage({
    id: `${input.from}-complete-${input.taskId}`,
    to: "lead",
    from: input.from,
    kind: "worker_complete",
    body: {
      schemaVersion: "v1",
      taskId: input.taskId,
      status: input.status,
      summary: input.summary,
    },
  });
  await run.transport.post({ room: run.roomRef, envelope: buildEnvelope(run.runId, message) });
}

async function postFinalReconciliation(
  run: Awaited<ReturnType<typeof createManualDispatchRun>>,
  completedTaskIds: string[],
) {
  const message = createMailboxMessage({
    id: `lead-final-${completedTaskIds.length}`,
    to: "lead",
    from: "lead",
    kind: "final_reconciliation",
    body: {
      schemaVersion: "v1",
      summary: "manual finalization",
      completedTaskIds,
    },
  });
  await run.transport.post({ room: run.roomRef, envelope: buildEnvelope(run.runId, message) });
}

async function waitForTasks(runDir: string, expectedCount: number): Promise<TaskRecord[]> {
  await waitFor(async () => (await readTasks(runDir)).length === expectedCount);
  return await readTasks(runDir);
}

async function waitForEvent(runDir: string, predicate: (event: AgentEvent) => boolean, timeoutMs = 5_000): Promise<AgentEvent> {
  await waitFor(async () => (await readEvents(runDir)).some(predicate), timeoutMs);
  return (await readEvents(runDir)).find(predicate)!;
}

async function readEvents(runDir: string): Promise<AgentEvent[]> {
  return await readJsonLines<AgentEvent>(join(runDir, "events.jsonl"));
}

async function readTasks(runDir: string): Promise<TaskRecord[]> {
  const raw = await readFile(join(runDir, "tasks.json"), "utf8");
  return (JSON.parse(raw) as { tasks?: TaskRecord[] }).tasks ?? [];
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

function taskByAssignee(tasks: TaskRecord[], assigneeId: string): TaskRecord {
  const task = tasks.find((entry) => entry.assigneeId === assigneeId);
  if (!task) {
    throw new Error(`task not found for ${assigneeId}`);
  }
  return task;
}

function createMailboxMessage(input: {
  id: string;
  to: string;
  from: string;
  kind: MailboxMessage["kind"];
  body: MailboxMessage["body"];
}): MailboxMessage {
  return {
    id: input.id,
    to: input.to,
    from: input.from,
    createdAt: new Date().toISOString(),
    kind: input.kind,
    body: input.body,
  };
}

function buildEnvelope(runId: string, body: MailboxMessage): MailboxEnvelope {
  return {
    schemaVersion: "v1",
    fromRole: body.from,
    toRole: body.to,
    runId,
    ...(typeof body.body === "object" && body.body !== null && "taskId" in body.body && typeof body.body.taskId === "string"
      ? { taskId: body.body.taskId }
      : {}),
    body,
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (true) {
    let ready = false;
    try {
      ready = await predicate();
    } catch {
      ready = false;
    }
    if (ready) {
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function withEnv<T>(entries: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const original = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(entries)) {
    original.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
