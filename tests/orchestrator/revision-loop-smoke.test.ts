import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAdapter } from "@/adapters/fake/index.js";
import { FakeMailboxTransport } from "@/adapters/fake/fake-mailbox-transport.js";
import type {
  EvaluatorVerdictBody,
  EvidencePacket,
  FinalReconciliationBody,
  MailboxEnvelope,
  MailboxMessage,
  RevisionRequestBody,
  TaskRecord,
  WorkerCompleteBody,
} from "@/contracts/four-layer.js";
import type { AgentEvent } from "@/contracts/types.js";
import { runManagerHarness } from "@/orchestrator/manager-run-harness.js";
import { readJsonFile, readJsonLines } from "../fixtures/live-smoke/_helpers.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.sequential("revision loop smoke", () => {
  it("records evaluator fail -> revision_request -> revision spawn -> success in runtime evidence", async () => {
    await withEnv({ PLUTO_DISPATCH_MODE: "teamlead_chat" }, async () => {
      const run = await createRevisionLoopRun("smoke");
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
      const persistedTasks = await readTasks(run.runDir);
      const mailboxEntries = await readJsonLines<MailboxMessage>(join(run.runDir, "mailbox.jsonl"));
      const events = await readJsonLines<AgentEvent>(join(run.runDir, "events.jsonl"));
      const evidencePacket = await readJsonFile<EvidencePacket>(join(run.runDir, "evidence-packet.json"));

      expect(result.run.status).toBe("succeeded");
      expect(taskById(persistedTasks, revisionTaskId).status).toBe("completed");
      expect(events.some((event) => event.type === "final_reconciliation_received")).toBe(true);
      expect(events.some((event) =>
        event.type === "evaluator_verdict_received"
        && event.payload["taskId"] === evaluatorTask.id
        && event.payload["verdict"] === "fail",
      )).toBe(true);
      expect(events.some((event) =>
        event.type === "revision_request_dispatched"
        && event.payload["failedTaskId"] === evaluatorTask.id
        && event.payload["revisionTaskId"] === revisionTaskId,
      )).toBe(true);
      expect(mailboxEntries.some((message) =>
        message.kind === "worker_complete"
        && typeof message.body === "object"
        && message.body !== null
        && (message.body as WorkerCompleteBody).taskId === revisionTaskId
        && (message.body as WorkerCompleteBody).status === "succeeded",
      )).toBe(true);
      expect(evidencePacket.status).toBe("succeeded");
      expect(evidencePacket.roleCitations?.filter((citation) => citation.role === "generator").length).toBeGreaterThanOrEqual(2);
      expect(evidencePacket.transitions?.filter((transition) => transition.to === "generator").length).toBeGreaterThanOrEqual(2);
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

async function createRevisionLoopRun(name: string) {
  const workspace = await mkdtemp(join(tmpdir(), `pluto-revision-loop-${name}-`));
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

async function driveTask(
  run: Awaited<ReturnType<typeof createRevisionLoopRun>>,
  task: TaskRecord,
) {
  await postSpawnRequest(run, { from: "lead", targetRole: task.assigneeId!, taskId: task.id });
  await waitForEvent(run.runDir, (event) =>
    event.type === "worker_complete_received"
    && event.payload["taskId"] === task.id,
  );
}

async function postSpawnRequest(
  run: Awaited<ReturnType<typeof createRevisionLoopRun>>,
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
  run: Awaited<ReturnType<typeof createRevisionLoopRun>>,
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
  run: Awaited<ReturnType<typeof createRevisionLoopRun>>,
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

async function postFinalReconciliation(
  run: Awaited<ReturnType<typeof createRevisionLoopRun>>,
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
  await waitFor(async () => (await readJsonLines<AgentEvent>(join(runDir, "events.jsonl"))).some(predicate), timeoutMs);
  return (await readJsonLines<AgentEvent>(join(runDir, "events.jsonl"))).find(predicate)!;
}

async function readTasks(runDir: string): Promise<TaskRecord[]> {
  const raw = await readFile(join(runDir, "tasks.json"), "utf8");
  return (JSON.parse(raw) as { tasks?: TaskRecord[] }).tasks ?? [];
}

function taskByAssignee(tasks: TaskRecord[], assigneeId: string): TaskRecord {
  const task = tasks.find((entry) => entry.assigneeId === assigneeId);
  if (!task) {
    throw new Error(`task not found for ${assigneeId}`);
  }
  return task;
}

function taskById(tasks: TaskRecord[], taskId: string): TaskRecord {
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(`task not found: ${taskId}`);
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
