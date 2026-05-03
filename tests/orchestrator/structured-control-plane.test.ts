import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import { FakeMailboxTransport } from "@/adapters/fake/fake-mailbox-transport.js";
import type {
  EvaluatorVerdictBody,
  FinalReconciliationBody,
  MailboxEnvelope,
  MailboxMessage,
  RevisionRequestBody,
  ShutdownRequestBody,
  ShutdownResponseBody,
  TaskRecord,
} from "@/contracts/four-layer.js";
import type { AgentEvent } from "@/contracts/types.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.sequential("structured control-plane", () => {
  it("records a trusted evaluator verdict without dispatching a revision", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createStructuredControlPlaneRun("verdict-pass");
      const tasks = await waitForTasks(run.runDir, 3);
      const plannerTask = taskByAssignee(tasks, "planner");
      const generatorTask = taskByAssignee(tasks, "generator");
      const evaluatorTask = taskByAssignee(tasks, "evaluator");

      await driveTask(run, plannerTask);
      await driveTask(run, generatorTask);
      await driveTask(run, evaluatorTask);

      const verdictMessageId = `evaluator-verdict-${evaluatorTask.id}`;
      await postEvaluatorVerdict(run, {
        id: verdictMessageId,
        from: "evaluator",
        taskId: evaluatorTask.id,
        verdict: "pass",
        rationale: "artifact satisfies the hello-team task",
      });

      await waitForEvent(run.runDir, (event) =>
        event.type === "evaluator_verdict_received"
        && event.payload["taskId"] === evaluatorTask.id
        && event.payload["verdict"] === "pass",
      );

      await pause(150);
      expect((await readEvents(run.runDir)).some((event) => event.type === "revision_request_dispatched")).toBe(false);

      await postFinalReconciliation(run, [plannerTask.id, generatorTask.id, evaluatorTask.id]);
      const result = await run.resultPromise;
      expect(result.run.status).toBe("succeeded");
    });
  });

  it("routes a failed evaluator verdict through revision_request and spawn_request", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createStructuredControlPlaneRun("verdict-fail-revision");
      const tasks = await waitForTasks(run.runDir, 3);
      const plannerTask = taskByAssignee(tasks, "planner");
      const generatorTask = taskByAssignee(tasks, "generator");
      const evaluatorTask = taskByAssignee(tasks, "evaluator");

      await driveTask(run, plannerTask);
      await driveTask(run, generatorTask);
      await driveTask(run, evaluatorTask);

      const verdictMessageId = `evaluator-verdict-${evaluatorTask.id}`;
      await postEvaluatorVerdict(run, {
        id: verdictMessageId,
        from: "evaluator",
        taskId: evaluatorTask.id,
        verdict: "fail",
        rationale: "generator should tighten the wording",
      });
      await waitForEvent(run.runDir, (event) =>
        event.type === "evaluator_verdict_received"
        && event.payload["taskId"] === evaluatorTask.id
        && event.payload["verdict"] === "fail",
      );

      await postRevisionRequest(run, {
        id: `lead-revision-${evaluatorTask.id}`,
        from: "lead",
        failedTaskId: evaluatorTask.id,
        failedVerdictMessageId: verdictMessageId,
        targetRole: "generator",
        instructions: "Revise the artifact with clearer one-line role outputs.",
      });

      const revisionDispatch = await waitForEvent(run.runDir, (event) =>
        event.type === "revision_request_dispatched"
        && event.payload["failedTaskId"] === evaluatorTask.id,
      );
      const revisionTaskId = String(revisionDispatch.payload["revisionTaskId"]);
      await waitForEvent(run.runDir, (event) =>
        event.type === "spawn_request_executed"
        && event.payload["taskId"] === revisionTaskId
        && event.payload["targetRole"] === "generator",
      );
      await waitForEvent(run.runDir, (event) =>
        event.type === "worker_complete_received"
        && event.payload["taskId"] === revisionTaskId,
      );

      await postFinalReconciliation(run, [plannerTask.id, generatorTask.id, evaluatorTask.id, revisionTaskId]);
      const result = await run.resultPromise;
      expect(result.run.status).toBe("succeeded");
    });
  });

  it("fans out shutdown requests to active sessions and resolves finalization after acknowledgments", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createStructuredControlPlaneRun("shutdown-happy");
      const tasks = await waitForTasks(run.runDir, 3);
      const plannerTask = taskByAssignee(tasks, "planner");
      const generatorTask = taskByAssignee(tasks, "generator");
      const evaluatorTask = taskByAssignee(tasks, "evaluator");

      await driveTask(run, plannerTask);
      await driveTask(run, generatorTask);
      await driveTask(run, evaluatorTask);

      await postShutdownRequest(run, {
        id: "lead-shutdown-happy",
        from: "lead",
        reason: "stop after the active teammates acknowledge",
      });

      await waitForEvent(run.runDir, (event) =>
        event.type === "shutdown_request_dispatched"
        && Array.isArray(event.payload["targetRoles"])
        && (event.payload["targetRoles"] as string[]).length === 3,
      );

      const shutdownMessages = run.adapter.getSentMessages().filter((entry) =>
        entry.via === "role" && entry.message.includes("\"kind\":\"shutdown_request\""),
      );
      expect(shutdownMessages.map((entry) => entry.roleId)).toEqual(["planner", "generator", "evaluator"]);

      await postShutdownResponse(run, {
        id: "planner-shutdown-response",
        from: "planner",
        fromTaskId: plannerTask.id,
      });
      await postShutdownResponse(run, {
        id: "generator-shutdown-response",
        from: "generator",
        fromTaskId: generatorTask.id,
      });
      await postShutdownResponse(run, {
        id: "evaluator-shutdown-response",
        from: "evaluator",
        fromTaskId: evaluatorTask.id,
      });

      const shutdownComplete = await waitForEvent(run.runDir, (event) => event.type === "shutdown_complete");
      expect(shutdownComplete.payload["ackedRoles"]).toEqual(["planner", "generator", "evaluator"]);
      expect(shutdownComplete.payload["timedOutRoles"]).toEqual([]);

      const result = await run.resultPromise;
      expect(result.run.status).toBe("succeeded");
    });
  });

  it("times out shutdown acknowledgments and still finalizes the run", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createStructuredControlPlaneRun("shutdown-timeout");
      const tasks = await waitForTasks(run.runDir, 3);
      const plannerTask = taskByAssignee(tasks, "planner");
      const generatorTask = taskByAssignee(tasks, "generator");
      const evaluatorTask = taskByAssignee(tasks, "evaluator");

      await driveTask(run, plannerTask);
      await driveTask(run, generatorTask);
      await driveTask(run, evaluatorTask);

      await postShutdownRequest(run, {
        id: "lead-shutdown-timeout",
        from: "lead",
        reason: "stop quickly",
        targetRole: "planner",
        timeoutMs: 100,
      });

      const shutdownComplete = await waitForEvent(run.runDir, (event) => event.type === "shutdown_complete", 8_000);
      expect(shutdownComplete.payload["ackedRoles"]).toEqual([]);
      expect(shutdownComplete.payload["timedOutRoles"]).toEqual(["planner"]);

      const result = await run.resultPromise;
      expect(result.run.status).toBe("succeeded");
    });
  });

  it("rejects evaluator_verdict from a non-claimer", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createStructuredControlPlaneRun("untrusted-verdict");
      const tasks = await waitForTasks(run.runDir, 3);
      const plannerTask = taskByAssignee(tasks, "planner");
      const generatorTask = taskByAssignee(tasks, "generator");
      const evaluatorTask = taskByAssignee(tasks, "evaluator");

      await driveTask(run, plannerTask);
      await driveTask(run, generatorTask);
      await driveTask(run, evaluatorTask);

      await postEvaluatorVerdict(run, {
        id: `forged-verdict-${generatorTask.id}`,
        from: "evaluator",
        taskId: generatorTask.id,
        verdict: "pass",
      });

      await waitForEvent(run.runDir, (event) =>
        event.type === "evaluator_verdict_untrusted_sender"
        && event.payload["taskId"] === generatorTask.id
        && event.payload["fromRole"] === "evaluator",
      );
      expect((await readEvents(run.runDir)).some((event) => event.type === "evaluator_verdict_received" && event.payload["taskId"] === generatorTask.id)).toBe(false);

      await postFinalReconciliation(run, [plannerTask.id, generatorTask.id, evaluatorTask.id]);
      await run.resultPromise;
    });
  });

  it("rejects revision_request from a non-lead sender", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createStructuredControlPlaneRun("untrusted-revision");
      const tasks = await waitForTasks(run.runDir, 3);
      const plannerTask = taskByAssignee(tasks, "planner");
      const generatorTask = taskByAssignee(tasks, "generator");
      const evaluatorTask = taskByAssignee(tasks, "evaluator");

      await driveTask(run, plannerTask);
      await driveTask(run, generatorTask);
      await driveTask(run, evaluatorTask);

      await postRevisionRequest(run, {
        id: "generator-revision-request",
        from: "generator",
        failedTaskId: evaluatorTask.id,
        failedVerdictMessageId: "missing-verdict",
        targetRole: "generator",
        instructions: "Ignore this forged revision request.",
      });

      await waitForEvent(run.runDir, (event) =>
        event.type === "revision_request_untrusted_sender"
        && event.payload["fromRole"] === "generator",
      );

      await pause(150);
      expect((await readTasks(run.runDir)).length).toBe(3);

      await postFinalReconciliation(run, [plannerTask.id, generatorTask.id, evaluatorTask.id]);
      await run.resultPromise;
    });
  });

  it("rejects shutdown_request from a non-lead sender", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createStructuredControlPlaneRun("untrusted-shutdown-request");
      const tasks = await waitForTasks(run.runDir, 3);
      const plannerTask = taskByAssignee(tasks, "planner");

      await driveTask(run, plannerTask);

      await postShutdownRequest(run, {
        id: "planner-shutdown-request",
        from: "planner",
        reason: "forged shutdown",
      });

      await waitForEvent(run.runDir, (event) =>
        event.type === "shutdown_request_untrusted_sender"
        && event.payload["fromRole"] === "planner",
      );
      expect(run.adapter.getSentMessages().some((entry) => entry.via === "role" && entry.message.includes("\"kind\":\"shutdown_request\""))).toBe(false);

      await postFinalReconciliation(run, [plannerTask.id]);
      await run.resultPromise;
    });
  });

  it("rejects shutdown_response from an unknown or inactive role", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createStructuredControlPlaneRun("untrusted-shutdown-response");
      const tasks = await waitForTasks(run.runDir, 3);
      const plannerTask = taskByAssignee(tasks, "planner");

      await driveTask(run, plannerTask);

      await postShutdownRequest(run, {
        id: "lead-shutdown-response-test",
        from: "lead",
        reason: "validate ack sender",
        timeoutMs: 500,
      });
      await waitForEvent(run.runDir, (event) => event.type === "shutdown_request_dispatched");

      await postShutdownResponse(run, {
        id: "qa-shutdown-response",
        from: "qa",
        fromTaskId: plannerTask.id,
      });
      await waitForEvent(run.runDir, (event) =>
        event.type === "shutdown_response_untrusted_sender"
        && event.payload["fromRole"] === "qa",
      );

      await postShutdownResponse(run, {
        id: "planner-shutdown-response-valid",
        from: "planner",
        fromTaskId: plannerTask.id,
      });
      const shutdownComplete = await waitForEvent(run.runDir, (event) => event.type === "shutdown_complete");
      expect(shutdownComplete.payload["ackedRoles"]).toEqual(["planner"]);
      expect(shutdownComplete.payload["timedOutRoles"]).toEqual([]);

      await run.resultPromise;
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

async function createStructuredControlPlaneRun(name: string) {
  const workspace = await mkdtemp(join(tmpdir(), `pluto-structured-${name}-`));
  const dataDir = join(workspace, ".pluto");
  const runId = `run-${name}`;
  let idSequence = 0;
  let adapter!: FakeAdapter;
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
    createAdapter: ({ team }) => {
      adapter = new FakeAdapter({ team });
      return adapter;
    },
    createMailboxTransport: () => transport,
  });

  const runDir = join(dataDir, "runs", runId);
  await waitFor(async () => {
    await access(join(runDir, "tasks.json"));
    return Boolean(transport.roomRef);
  });

  return { adapter, dataDir, resultPromise, roomRef: transport.roomRef!, runDir, runId, transport, workspace };
}

async function driveTask(
  run: Awaited<ReturnType<typeof createStructuredControlPlaneRun>>,
  task: TaskRecord,
) {
  await postSpawnRequest(run, { from: "lead", targetRole: task.assigneeId!, taskId: task.id });
  await waitForEvent(run.runDir, (event) =>
    event.type === "worker_complete_received"
    && event.payload["taskId"] === task.id,
  );
}

async function postSpawnRequest(
  run: Awaited<ReturnType<typeof createStructuredControlPlaneRun>>,
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

async function postEvaluatorVerdict(
  run: Awaited<ReturnType<typeof createStructuredControlPlaneRun>>,
  input: { id: string; from: string } & Omit<EvaluatorVerdictBody, "schemaVersion">,
) {
  const message = createMailboxMessage({
    id: input.id,
    to: "lead",
    from: input.from,
    kind: "evaluator_verdict",
    body: {
      schemaVersion: "v1",
      taskId: input.taskId,
      verdict: input.verdict,
      ...(input.rationale ? { rationale: input.rationale } : {}),
      ...(input.failedRubricRef ? { failedRubricRef: input.failedRubricRef } : {}),
    },
  });
  await run.transport.post({ room: run.roomRef, envelope: buildEnvelope(run.runId, message) });
}

async function postRevisionRequest(
  run: Awaited<ReturnType<typeof createStructuredControlPlaneRun>>,
  input: { id: string; from: string } & Omit<RevisionRequestBody, "schemaVersion">,
) {
  const message = createMailboxMessage({
    id: input.id,
    to: "lead",
    from: input.from,
    kind: "revision_request",
    body: {
      schemaVersion: "v1",
      failedTaskId: input.failedTaskId,
      failedVerdictMessageId: input.failedVerdictMessageId,
      targetRole: input.targetRole,
      instructions: input.instructions,
    },
  });
  await run.transport.post({ room: run.roomRef, envelope: buildEnvelope(run.runId, message) });
}

async function postShutdownRequest(
  run: Awaited<ReturnType<typeof createStructuredControlPlaneRun>>,
  input: { id: string; from: string } & Omit<ShutdownRequestBody, "schemaVersion">,
) {
  const message = createMailboxMessage({
    id: input.id,
    to: "lead",
    from: input.from,
    kind: "shutdown_request",
    body: {
      schemaVersion: "v1",
      reason: input.reason,
      ...(input.targetRole ? { targetRole: input.targetRole } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    },
  });
  await run.transport.post({ room: run.roomRef, envelope: buildEnvelope(run.runId, message) });
}

async function postShutdownResponse(
  run: Awaited<ReturnType<typeof createStructuredControlPlaneRun>>,
  input: { id: string; from: string; fromTaskId?: string },
) {
  const body: ShutdownResponseBody = {
    schemaVersion: "v1",
    acknowledged: true,
    ...(input.fromTaskId ? { fromTaskId: input.fromTaskId } : {}),
  };
  const message = createMailboxMessage({
    id: input.id,
    to: "lead",
    from: input.from,
    kind: "shutdown_response",
    body,
  });
  await run.transport.post({ room: run.roomRef, envelope: buildEnvelope(run.runId, message) });
}

async function postFinalReconciliation(
  run: Awaited<ReturnType<typeof createStructuredControlPlaneRun>>,
  completedTaskIds: string[],
) {
  const body: FinalReconciliationBody = {
    schemaVersion: "v1",
    summary: "manual finalization",
    completedTaskIds,
  };
  const message = createMailboxMessage({
    id: `lead-final-${completedTaskIds.length}`,
    to: "lead",
    from: "lead",
    kind: "final_reconciliation",
    body,
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

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
    await pause(25);
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
