import type { PaseoTeamAdapter } from "../../contracts/adapter.js";
import type { AgentEvent, AgentEventType, AgentRoleConfig } from "../../contracts/types.js";
import type {
  DispatchOrchestrationSource,
  EvidenceAuditHookBoundary,
  MailboxMessage,
  MailboxMessageKind,
  TaskRecord,
  WorkerCompleteBody,
} from "../../contracts/four-layer.js";
import { createIdleNudgeHook, createPlanApprovalRequest, runHooks } from "../../four-layer/index.js";
import { buildCompletionMessageBody, extractStructuredWorkerMessage, findWorkerCompletedEvent, firstNonEmptyLine } from "./utilities.js";

export interface DispatchPlanEntry {
  index: number;
  role: AgentRoleConfig;
  task: TaskRecord;
}

export interface SendMailboxMessageInput {
  to: string;
  from: string;
  kind?: MailboxMessageKind;
  body: MailboxMessage["body"];
  summary?: string;
  replyTo?: string;
  transportReplyTo?: string;
  taskId?: string;
}

export interface ExecuteDispatchEntryInput {
  runId: string;
  dispatchMode: DispatchOrchestrationSource;
  entry: DispatchPlanEntry;
  adapter: PaseoTeamAdapter;
  taskList: {
    claim(taskId: string, roleId: string): Promise<TaskRecord>;
  };
  leadRoleId: string;
  leadSessionId: string;
  sendMailboxMessage: (input: SendMailboxMessageInput) => Promise<MailboxMessage>;
  recordMailboxMessageEvent: (
    message: MailboxMessage,
    roleId?: string,
    sessionId?: string,
    orchestrationSource?: DispatchOrchestrationSource,
    extraPayload?: Record<string, unknown>,
  ) => Promise<void>;
  emit: (type: AgentEventType, payload?: Record<string, unknown>, roleId?: string, sessionId?: string) => Promise<AgentEvent>;
  persistAdapterEvents: () => Promise<AgentEvent[]>;
  auditRuntimeMirrors: (hookBoundary: EvidenceAuditHookBoundary) => Promise<void>;
  taskInstructionsFor: (taskRecord: TaskRecord) => string;
  setRoleSessionId: (roleId: string, sessionId: string) => void;
  relayStructuredMessages: boolean;
  completionMode: "none" | "worker_complete" | "plain_note";
  rememberCompletionMessage?: (message: MailboxMessage) => void;
  beforeCompletion?: (result: { output: string; workerSessionId: string }) => Promise<void>;
}

export async function executeDispatchEntry(input: ExecuteDispatchEntryInput): Promise<{
  output: string;
  workerSessionId: string;
  completionMessage?: MailboxMessage;
}> {
  const claimedTask = await input.taskList.claim(input.entry.task.id, input.entry.role.id);
  await input.emit("task_claimed", {
    taskId: claimedTask.id,
    claimedBy: input.entry.role.id,
    orchestrationSource: input.dispatchMode,
  }, input.entry.role.id);

  const idleHook = createIdleNudgeHook({ roleId: input.entry.role.id, taskList: input.taskList as never });
  await runHooks([idleHook], { roleId: input.entry.role.id });
  await input.auditRuntimeMirrors("teammate_idle");
  const taskInstructions = input.taskInstructionsFor(claimedTask);

  const workerSession = await input.adapter.createWorkerSession({
    runId: input.runId,
    role: input.entry.role,
    instructions: `Task ${input.entry.task.id}\n${taskInstructions}`,
  });
  input.setRoleSessionId(input.entry.role.id, workerSession.sessionId);

  const assignmentMessage = await input.sendMailboxMessage({
    to: input.entry.role.id,
    from: input.leadRoleId,
    summary: `TASK ${input.entry.task.id}`,
    body: `Task ${input.entry.task.id}\nRole: ${input.entry.role.id}\nGoal: ${taskInstructions}`,
    replyTo: input.entry.task.id,
    taskId: input.entry.task.id,
  });
  await input.recordMailboxMessageEvent(assignmentMessage, input.entry.role.id, input.leadSessionId);

  if (input.entry.role.id === "planner") {
    const requestBody = createPlanApprovalRequest({
      plan: `Plan for ${input.entry.task.id}: ${taskInstructions}`,
      requestedMode: "workspace_write",
      taskId: input.entry.task.id,
    });
    const requestMessage = await input.sendMailboxMessage({
      to: input.leadRoleId,
      from: input.entry.role.id,
      kind: "plan_approval_request",
      summary: `PLAN ${input.entry.task.id}`,
      body: requestBody,
      replyTo: input.entry.task.id,
      taskId: input.entry.task.id,
    });
    await input.recordMailboxMessageEvent(requestMessage, input.entry.role.id, workerSession.sessionId);
    await input.emit("plan_approval_requested", { messageId: requestMessage.id, taskId: input.entry.task.id }, input.entry.role.id);
  }

  const workerEvents = await input.persistAdapterEvents();
  const completedEvent = findWorkerCompletedEvent(workerEvents, input.entry.role.id);
  const completedSessionId = completedEvent?.sessionId ?? workerSession.sessionId;
  const output = completedEvent
    ? String(completedEvent.transient?.rawPayload?.output ?? completedEvent.payload.output ?? "")
    : `Contribution from ${input.entry.role.id}.`;

  if (input.relayStructuredMessages) {
    const structuredWorkerMessage = extractStructuredWorkerMessage(output, input.entry.task.id);
    if (structuredWorkerMessage) {
      const relayedMessage = await input.sendMailboxMessage({
        to: input.leadRoleId,
        from: input.entry.role.id,
        kind: structuredWorkerMessage.kind,
        summary: structuredWorkerMessage.summary,
        body: structuredWorkerMessage.body,
        replyTo: input.entry.task.id,
        taskId: input.entry.task.id,
      });
      await input.recordMailboxMessageEvent(relayedMessage, input.entry.role.id, completedSessionId, input.dispatchMode);
    }
  }

  await input.beforeCompletion?.({ output, workerSessionId: workerSession.sessionId });

  let completionMessage: MailboxMessage | undefined;
  if (input.completionMode === "worker_complete") {
    completionMessage = await input.sendMailboxMessage({
      to: input.leadRoleId,
      from: input.entry.role.id,
      kind: "worker_complete",
      summary: `COMPLETE ${input.entry.task.id}`,
      body: {
        schemaVersion: "v1",
        taskId: input.entry.task.id,
        status: "succeeded",
        summary: firstNonEmptyLine(output) || "completed",
      } satisfies WorkerCompleteBody,
      replyTo: input.entry.task.id,
      taskId: input.entry.task.id,
    });
    input.rememberCompletionMessage?.(completionMessage);
    await input.recordMailboxMessageEvent(completionMessage, input.entry.role.id, completedSessionId, input.dispatchMode);
  } else if (input.completionMode === "plain_note") {
    completionMessage = await input.sendMailboxMessage({
      to: input.leadRoleId,
      from: input.entry.role.id,
      summary: `COMPLETE ${input.entry.task.id}`,
      body: buildCompletionMessageBody(input.entry.task.id, output),
      replyTo: input.entry.task.id,
      taskId: input.entry.task.id,
    });
    input.rememberCompletionMessage?.(completionMessage);
    await input.recordMailboxMessageEvent(completionMessage, input.entry.role.id, completedSessionId);
  }

  return {
    output,
    workerSessionId: workerSession.sessionId,
    ...(completionMessage ? { completionMessage } : {}),
  };
}
