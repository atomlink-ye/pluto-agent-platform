import type { PaseoTeamAdapter } from "../../contracts/adapter.js";
import type { AgentEvent, AgentEventType, AgentRoleConfig } from "../../contracts/types.js";
import type {
  DispatchOrchestrationSource,
  EvaluatorVerdictBody,
  FinalReconciliationBody,
  MailboxMessage,
  SpawnRequestBody,
  TaskRecord,
} from "../../contracts/four-layer.js";
import {
  createPlanApprovalResponse,
  isEvaluatorVerdict,
  isFinalReconciliation,
  isRevisionRequest,
  isShutdownRequest,
  isShutdownResponse,
  isSpawnRequest,
  isTrustedPlanApprovalResponse,
  isWorkerComplete,
} from "../../four-layer/index.js";
import { executeDispatchEntry, type DispatchPlanEntry, type SendMailboxMessageInput as DispatchSendMailboxMessageInput } from "./dispatch-executor.js";

interface ShutdownTracker {
  expectedRoles: Map<string, "pending" | "received" | "timed_out">;
  timeoutMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface CreateLeadControlPlaneInput {
  runId: string;
  dispatchMode: DispatchOrchestrationSource;
  autoDriveDispatch: boolean;
  runtimeHelperMvp: boolean;
  taskList: {
    create(input: { assigneeId?: string; dependsOn: string[]; summary: string }): Promise<TaskRecord>;
    read(taskId: string): Promise<TaskRecord | null>;
    complete(taskId: string, artifactRefs: unknown[]): Promise<void>;
    claim(taskId: string, roleId: string): Promise<TaskRecord>;
  };
  adapter: PaseoTeamAdapter;
  leadRole: AgentRoleConfig;
  leadSessionId: string;
  memberRoles: AgentRoleConfig[];
  memberRoleById: Map<string, AgentRoleConfig>;
  validRubricRefs: Set<string>;
  dispatchPlan: DispatchPlanEntry[];
  dispatchPlanByTaskId: Map<string, DispatchPlanEntry>;
  completedDispatchTaskIds: Set<string>;
  sendMailboxMessage: (input: DispatchSendMailboxMessageInput) => Promise<MailboxMessage>;
  recordMailboxMessageEvent: (
    message: MailboxMessage,
    roleId?: string,
    sessionId?: string,
    orchestrationSource?: DispatchOrchestrationSource,
    extraPayload?: Record<string, unknown>,
  ) => Promise<void>;
  emit: (type: AgentEventType, payload?: Record<string, unknown>, roleId?: string, sessionId?: string) => Promise<AgentEvent>;
  resolveSessionId: (roleId: string) => string | undefined;
  setRoleSessionId: (roleId: string, sessionId: string) => void;
  persistAdapterEvents: () => Promise<AgentEvent[]>;
  auditRuntimeMirrors: (hookBoundary: "teammate_idle" | "task_completed" | "run_end") => Promise<void>;
  taskInstructionsFor: (taskRecord: TaskRecord) => string;
  rememberCompletionMessage: (message: MailboxMessage) => void;
  onDispatchOutput: (entry: DispatchPlanEntry, message: MailboxMessage, output: string, workerSessionId: string) => Promise<void>;
  setLastTask: (task: TaskRecord) => void;
}

export function createLeadControlPlane(input: CreateLeadControlPlaneInput): {
  handleLeadSemanticMailboxMessage: (message: MailboxMessage) => Promise<boolean>;
  handleLeadMailboxMessage: (message: MailboxMessage) => Promise<boolean>;
  autoRespondToPlanApproval: (message: MailboxMessage) => Promise<void>;
  postSpawnRequest: (entry: DispatchPlanEntry, rationale?: string) => Promise<void>;
  postFinalReconciliation: () => Promise<void>;
  finalReconciliationPromise: Promise<FinalReconciliationBody>;
  rejectFinalReconciliation: (reason?: unknown) => void;
} {
  const respondedPlanApprovalRequests = new Set<string>();
  const processedLeadMailboxMessageIds = new Set<string>();
  const processedLeadSemanticMailboxMessageIds = new Set<string>();
  const evaluatorVerdictsByMessageId = new Map<string, EvaluatorVerdictBody>();
  let shutdownTracker: ShutdownTracker | null = null;
  let finalReconciliationSettled = false;
  let resolveFinalReconciliation!: (body: FinalReconciliationBody) => void;
  let rejectFinalReconciliationPromise!: (reason?: unknown) => void;
  const finalReconciliationPromise = new Promise<FinalReconciliationBody>((resolve, reject) => {
    resolveFinalReconciliation = resolve;
    rejectFinalReconciliationPromise = reject;
  });

  const rejectFinalReconciliation = (reason?: unknown) => {
    if (shutdownTracker?.timer) {
      clearTimeout(shutdownTracker.timer);
      shutdownTracker.timer = null;
    }
    if (finalReconciliationSettled) {
      return;
    }
    finalReconciliationSettled = true;
    rejectFinalReconciliationPromise(reason);
  };

  const completeShutdown = async () => {
    const tracker = shutdownTracker;
    if (!tracker || finalReconciliationSettled) {
      return;
    }
    if (tracker.timer) {
      clearTimeout(tracker.timer);
      tracker.timer = null;
    }
    const ackedRoles = Array.from(tracker.expectedRoles.entries())
      .filter(([, state]) => state === "received")
      .map(([roleId]) => roleId);
    const timedOutRoles = Array.from(tracker.expectedRoles.entries())
      .filter(([, state]) => state === "timed_out")
      .map(([roleId]) => roleId);
    await input.emit("shutdown_complete", {
      ackedRoles,
      timedOutRoles,
      orchestrationSource: input.dispatchMode,
    }, input.leadRole.id, input.leadSessionId);
    finalReconciliationSettled = true;
    resolveFinalReconciliation({
      schemaVersion: "v1",
      summary: timedOutRoles.length > 0
        ? `Shutdown completed with timeouts for ${timedOutRoles.join(", ")}.`
        : `Shutdown completed after acknowledgments from ${ackedRoles.join(", ") || "no active teammates"}.`,
      completedTaskIds: Array.from(input.completedDispatchTaskIds),
    });
  };

  const postSpawnRequest = async (entry: DispatchPlanEntry, rationale?: string) => {
    const requestMessage = await input.sendMailboxMessage({
      to: input.leadRole.id,
      from: input.leadRole.id,
      kind: "spawn_request",
      summary: `SPAWN ${entry.task.id}`,
      body: {
        schemaVersion: "v1",
        targetRole: entry.role.id,
        taskId: entry.task.id,
        ...(rationale ? { rationale } : {}),
      } satisfies SpawnRequestBody,
      replyTo: entry.task.id,
      taskId: entry.task.id,
    });
    await input.recordMailboxMessageEvent(requestMessage, input.leadRole.id, input.leadSessionId, input.dispatchMode);
  };

  const autoRespondToPlanApproval = async (message: MailboxMessage) => {
    if (respondedPlanApprovalRequests.has(message.id)) {
      return;
    }
    const taskId = typeof message.body === "object" && message.body !== null && "taskId" in message.body
      ? String((message.body as { taskId?: string }).taskId ?? "") || undefined
      : undefined;
    if (finalReconciliationSettled) {
      respondedPlanApprovalRequests.add(message.id);
      return;
    }
    if (taskId) {
      const currentTask = await input.taskList.read(taskId);
      if (currentTask?.status === "completed") {
        respondedPlanApprovalRequests.add(message.id);
        return;
      }
    }
    respondedPlanApprovalRequests.add(message.id);
    const responseMessage = await input.sendMailboxMessage({
      to: message.from,
      from: input.leadRole.id,
      kind: "plan_approval_response",
      summary: taskId ? `PLAN_APPROVED ${taskId}` : "PLAN_APPROVED",
      body: createPlanApprovalResponse({ approved: true, mode: "workspace_write", taskId }),
      replyTo: message.id,
      transportReplyTo: message.transportMessageId,
      taskId,
    });
    if (!isTrustedPlanApprovalResponse(responseMessage, input.leadRole.id)) {
      throw new Error(`untrusted_plan_approval_response:${taskId ?? message.id}`);
    }
    await input.recordMailboxMessageEvent(responseMessage, input.leadRole.id, input.leadSessionId);
    await input.emit("plan_approval_responded", { messageId: responseMessage.id, taskId: taskId ?? null }, input.leadRole.id, input.leadSessionId);
  };

  const postFinalReconciliation = async () => {
    const reconciliationMessage = await input.sendMailboxMessage({
      to: input.leadRole.id,
      from: input.leadRole.id,
      kind: "final_reconciliation",
      summary: "FINAL_RECONCILIATION",
      body: {
        schemaVersion: "v1",
        summary: `Completed ${input.completedDispatchTaskIds.size} dispatched tasks.`,
        completedTaskIds: Array.from(input.completedDispatchTaskIds),
      } satisfies FinalReconciliationBody,
    });
    await input.recordMailboxMessageEvent(reconciliationMessage, input.leadRole.id, input.leadSessionId, input.dispatchMode);
  };

  const handleSpawnRequest = async (
    message: MailboxMessage,
    processedMessageIds: Set<string>,
  ): Promise<boolean> => {
    if (processedMessageIds.has(message.id)) {
      return true;
    }
    processedMessageIds.add(message.id);
    await input.emit("spawn_request_received", {
      messageId: message.id,
      taskId: isSpawnRequest(message) ? message.body.taskId : null,
      orchestrationSource: input.dispatchMode,
    }, input.leadRole.id, input.leadSessionId);
    if (message.from !== input.leadRole.id) {
      await input.emit("spawn_request_untrusted_sender", {
        messageId: message.id,
        fromRole: message.from,
        orchestrationSource: input.dispatchMode,
      }, input.leadRole.id, input.leadSessionId);
      return true;
    }
    if (!isSpawnRequest(message)) {
      await input.emit("spawn_request_rejected", {
        messageId: message.id,
        reason: "invalid_body",
        orchestrationSource: input.dispatchMode,
      }, input.leadRole.id, input.leadSessionId);
      return true;
    }
    const entry = input.dispatchPlanByTaskId.get(message.body.taskId);
    if (!entry || entry.role.id !== message.body.targetRole || !input.memberRoleById.has(message.body.targetRole)) {
      await input.emit("spawn_request_rejected", {
        messageId: message.id,
        taskId: message.body.taskId,
        targetRole: message.body.targetRole,
        reason: "target_role_not_in_playbook",
        orchestrationSource: input.dispatchMode,
      }, input.leadRole.id, input.leadSessionId);
      return true;
    }
    const currentTask = await input.taskList.read(entry.task.id);
    if (!currentTask || currentTask.status !== "pending") {
      await input.emit("spawn_request_rejected", {
        messageId: message.id,
        taskId: entry.task.id,
        targetRole: entry.role.id,
        reason: currentTask ? `task_not_pending:${currentTask.status}` : "task_not_found",
        orchestrationSource: input.dispatchMode,
      }, input.leadRole.id, input.leadSessionId);
      return true;
    }

    try {
      await executeDispatchEntry({
        runId: input.runId,
        dispatchMode: input.dispatchMode,
        entry,
        adapter: input.adapter,
        taskList: input.taskList,
        leadRoleId: input.leadRole.id,
        leadSessionId: input.leadSessionId,
        sendMailboxMessage: input.sendMailboxMessage,
        recordMailboxMessageEvent: input.recordMailboxMessageEvent,
        emit: input.emit,
        persistAdapterEvents: input.persistAdapterEvents,
        auditRuntimeMirrors: input.auditRuntimeMirrors,
        taskInstructionsFor: input.taskInstructionsFor,
        setRoleSessionId: input.setRoleSessionId,
        relayStructuredMessages: true,
        completionMode: input.runtimeHelperMvp ? "none" : "worker_complete",
        rememberCompletionMessage: input.rememberCompletionMessage,
        beforeCompletion: async ({ output, workerSessionId }) => {
          await input.onDispatchOutput(entry, message, output, workerSessionId);
        },
      });
    } catch (error) {
      const reason = error instanceof Error && error.message.startsWith("task_blocked:")
        ? "dependsOn_unsatisfied"
        : (error instanceof Error ? error.message : String(error));
      await input.emit("spawn_request_rejected", {
        messageId: message.id,
        taskId: entry.task.id,
        targetRole: entry.role.id,
        reason,
        orchestrationSource: input.dispatchMode,
      }, input.leadRole.id, input.leadSessionId);
    }
    return true;
  };

  const handleWorkerComplete = async (
    message: MailboxMessage,
    processedMessageIds: Set<string>,
  ): Promise<boolean> => {
    if (processedMessageIds.has(message.id)) {
      return true;
    }
    processedMessageIds.add(message.id);
    if (!isWorkerComplete(message)) {
      return true;
    }
    const currentTask = await input.taskList.read(message.body.taskId);
    const sessionId = input.resolveSessionId(message.from);
    if (!currentTask || currentTask.claimedBy !== message.from) {
      await input.emit("worker_complete_untrusted_sender", {
        messageId: message.id,
        taskId: message.body.taskId,
        fromRole: message.from,
        claimedBy: currentTask?.claimedBy ?? null,
        orchestrationSource: input.dispatchMode,
      }, message.from as AgentEvent["roleId"], sessionId);
      return true;
    }
    input.rememberCompletionMessage(message);
    await input.taskList.complete(message.body.taskId, message.body.artifactRef ? [message.body.artifactRef] : []);
    input.completedDispatchTaskIds.add(message.body.taskId);
    await input.emit("worker_complete_received", {
      messageId: message.id,
      taskId: message.body.taskId,
      status: message.body.status,
      orchestrationSource: input.dispatchMode,
    }, message.from as AgentEvent["roleId"], sessionId);
    await input.emit("task_completed", {
      taskId: message.body.taskId,
      messageId: message.id,
      orchestrationSource: input.dispatchMode,
    }, message.from as AgentEvent["roleId"], sessionId);

    if (!input.autoDriveDispatch) {
      return true;
    }
    const nextEntry = input.dispatchPlan.find((entry) =>
      !input.completedDispatchTaskIds.has(entry.task.id)
      && entry.task.dependsOn.every((dependencyId) => input.completedDispatchTaskIds.has(dependencyId)),
    );
    if (nextEntry) {
      await postSpawnRequest(nextEntry, `Continue after ${message.body.taskId}.`);
      return true;
    }
    if (input.dispatchPlan.length > 0 && input.completedDispatchTaskIds.size === input.dispatchPlan.length) {
      await postFinalReconciliation();
    }
    return true;
  };

  const handleEvaluatorVerdict = async (
    message: MailboxMessage,
    processedMessageIds: Set<string>,
  ): Promise<boolean> => {
    if (processedMessageIds.has(message.id)) {
      return true;
    }
    processedMessageIds.add(message.id);
    if (!isEvaluatorVerdict(message)) {
      return true;
    }
    const currentTask = await input.taskList.read(message.body.taskId);
    const sessionId = input.resolveSessionId(message.from);
    if (!currentTask || currentTask.claimedBy !== message.from) {
      await input.emit("evaluator_verdict_untrusted_sender", {
        messageId: message.id,
        taskId: message.body.taskId,
        fromRole: message.from,
        claimedBy: currentTask?.claimedBy ?? null,
        orchestrationSource: input.dispatchMode,
      }, message.from as AgentEvent["roleId"], sessionId);
      return true;
    }
    if (message.body.failedRubricRef && !input.validRubricRefs.has(message.body.failedRubricRef)) {
      return true;
    }
    evaluatorVerdictsByMessageId.set(message.id, message.body);
    await input.emit("evaluator_verdict_received", {
      taskId: message.body.taskId,
      verdict: message.body.verdict,
      ...(message.body.failedRubricRef ? { failedRubricRef: message.body.failedRubricRef } : {}),
      orchestrationSource: input.dispatchMode,
    }, message.from as AgentEvent["roleId"], sessionId);
    return true;
  };

  const handleRevisionRequest = async (message: MailboxMessage): Promise<boolean> => {
    if (!isRevisionRequest(message)) {
      return true;
    }
    if (message.from !== input.leadRole.id) {
      await input.emit("revision_request_untrusted_sender", {
        messageId: message.id,
        fromRole: message.from,
        orchestrationSource: input.dispatchMode,
      }, input.leadRole.id, input.leadSessionId);
      return true;
    }
    const failedTask = await input.taskList.read(message.body.failedTaskId);
    const failedVerdict = evaluatorVerdictsByMessageId.get(message.body.failedVerdictMessageId);
    const targetRole = input.memberRoleById.get(message.body.targetRole);
    if (!failedTask || !failedVerdict || failedVerdict.verdict !== "fail" || !targetRole) {
      return true;
    }
    await input.emit("revision_request_received", {
      messageId: message.id,
      failedTaskId: message.body.failedTaskId,
      failedVerdictMessageId: message.body.failedVerdictMessageId,
      targetRole: message.body.targetRole,
      orchestrationSource: input.dispatchMode,
    }, input.leadRole.id, input.leadSessionId);
    const revisionTask = await input.taskList.create({
      assigneeId: targetRole.id,
      dependsOn: [message.body.failedTaskId],
      summary: `${targetRole.id}: ${message.body.instructions}`,
    });
    const revisionEntry: DispatchPlanEntry = {
      index: input.dispatchPlan.length + input.dispatchPlanByTaskId.size,
      role: targetRole,
      task: revisionTask,
    };
    input.dispatchPlanByTaskId.set(revisionTask.id, revisionEntry);
    input.setLastTask(revisionTask);
    await input.emit("task_created", {
      taskId: revisionTask.id,
      summary: revisionTask.summary,
      dependsOn: revisionTask.dependsOn,
      orchestrationSource: input.dispatchMode,
    }, targetRole.id);
    const syntheticSpawn = await input.sendMailboxMessage({
      to: input.leadRole.id,
      from: input.leadRole.id,
      kind: "spawn_request",
      summary: `SPAWN ${revisionTask.id}`,
      body: {
        schemaVersion: "v1",
        targetRole: targetRole.id,
        taskId: revisionTask.id,
        rationale: message.body.instructions,
      } satisfies SpawnRequestBody,
      replyTo: revisionTask.id,
      taskId: revisionTask.id,
    });
    await input.recordMailboxMessageEvent(syntheticSpawn, input.leadRole.id, input.leadSessionId, input.dispatchMode);
    await input.emit("revision_request_dispatched", {
      messageId: message.id,
      failedTaskId: message.body.failedTaskId,
      revisionTaskId: revisionTask.id,
      targetRole: targetRole.id,
      spawnMessageId: syntheticSpawn.id,
      orchestrationSource: input.dispatchMode,
    }, input.leadRole.id, input.leadSessionId);
    return true;
  };

  const handleShutdownRequest = async (message: MailboxMessage): Promise<boolean> => {
    if (!isShutdownRequest(message)) {
      return true;
    }
    if (message.from !== input.leadRole.id) {
      await input.emit("shutdown_request_untrusted_sender", {
        messageId: message.id,
        fromRole: message.from,
        orchestrationSource: input.dispatchMode,
      }, input.leadRole.id, input.leadSessionId);
      return true;
    }
    const activeRoleSessions = await input.adapter.listActiveRoleSessions({ runId: input.runId });
    const activeWorkerRoles = input.memberRoles
      .map((role) => role.id)
      .filter((roleId) => typeof activeRoleSessions[roleId] === "string" && activeRoleSessions[roleId].length > 0);
    const targetRoles = message.body.targetRole
      ? activeWorkerRoles.filter((roleId) => roleId === message.body.targetRole)
      : activeWorkerRoles;
    const timeoutMs = message.body.timeoutMs ?? 30_000;
    await input.emit("shutdown_request_received", {
      messageId: message.id,
      targetRole: message.body.targetRole ?? null,
      timeoutMs,
      targetRoles,
      orchestrationSource: input.dispatchMode,
    }, input.leadRole.id, input.leadSessionId);
    if (shutdownTracker?.timer) {
      clearTimeout(shutdownTracker.timer);
    }
    shutdownTracker = {
      expectedRoles: new Map(targetRoles.map((roleId) => [roleId, "pending" as const])),
      timeoutMs,
      timer: null,
    };
    const shutdownPayload = (targetRole: string) => JSON.stringify({
      id: message.id,
      to: targetRole,
      from: input.leadRole.id,
      kind: message.kind,
      summary: message.summary,
      replyTo: message.replyTo,
      body: message.body,
    });
    for (const targetRole of targetRoles) {
      await input.adapter.sendRoleMessage({
        runId: input.runId,
        roleId: targetRole,
        message: shutdownPayload(targetRole),
        wait: false,
      });
    }
    shutdownTracker.timer = setTimeout(() => {
      if (!shutdownTracker) {
        return;
      }
      for (const [roleId, state] of shutdownTracker.expectedRoles.entries()) {
        if (state === "pending") {
          shutdownTracker.expectedRoles.set(roleId, "timed_out");
        }
      }
      void completeShutdown().catch(rejectFinalReconciliation);
    }, timeoutMs);
    await input.emit("shutdown_request_dispatched", {
      messageId: message.id,
      targetRole: message.body.targetRole ?? null,
      targetRoles,
      timeoutMs,
      orchestrationSource: input.dispatchMode,
    }, input.leadRole.id, input.leadSessionId);
    if (targetRoles.length === 0) {
      await completeShutdown();
    }
    return true;
  };

  const handleShutdownResponse = async (message: MailboxMessage): Promise<boolean> => {
    if (!isShutdownResponse(message)) {
      return true;
    }
    const activeRoleSessions = await input.adapter.listActiveRoleSessions({ runId: input.runId });
    const sessionId = input.resolveSessionId(message.from);
    if (!input.memberRoleById.has(message.from) || typeof activeRoleSessions[message.from] !== "string") {
      await input.emit("shutdown_response_untrusted_sender", {
        messageId: message.id,
        fromRole: message.from,
        orchestrationSource: input.dispatchMode,
      }, message.from as AgentEvent["roleId"], sessionId);
      return true;
    }
    if (shutdownTracker?.expectedRoles.has(message.from)) {
      shutdownTracker.expectedRoles.set(message.from, "received");
    }
    await input.emit("shutdown_response_received", {
      messageId: message.id,
      fromRole: message.from,
      ...(message.body.fromTaskId ? { fromTaskId: message.body.fromTaskId } : {}),
      orchestrationSource: input.dispatchMode,
    }, message.from as AgentEvent["roleId"], sessionId);
    if (shutdownTracker && Array.from(shutdownTracker.expectedRoles.values()).every((state) => state === "received")) {
      await completeShutdown();
    }
    return true;
  };

  const handleFinalReconciliation = async (
    message: MailboxMessage,
    processedMessageIds: Set<string>,
  ): Promise<boolean> => {
    if (processedMessageIds.has(message.id)) {
      return true;
    }
    processedMessageIds.add(message.id);
    if (!isFinalReconciliation(message)) {
      return true;
    }
    if (message.from !== input.leadRole.id) {
      await input.emit("final_reconciliation_invalid", {
        messageId: message.id,
        fromRole: message.from,
        reason: "untrusted_sender",
        orchestrationSource: input.dispatchMode,
      }, input.leadRole.id, input.leadSessionId);
      return true;
    }
    await input.emit("final_reconciliation_received", {
      messageId: message.id,
      completedTaskIds: message.body.completedTaskIds,
      orchestrationSource: input.dispatchMode,
    }, input.leadRole.id, input.leadSessionId);
    if (!finalReconciliationSettled) {
      finalReconciliationSettled = true;
      resolveFinalReconciliation(message.body);
    }
    return true;
  };

  const handleLeadSemanticMailboxMessage = async (message: MailboxMessage): Promise<boolean> => {
    if (input.dispatchMode !== "teamlead_chat") {
      return false;
    }

    switch (message.kind) {
      case "evaluator_verdict":
        return await handleEvaluatorVerdict(message, processedLeadSemanticMailboxMessageIds);
      case "spawn_request":
        return await handleSpawnRequest(message, processedLeadSemanticMailboxMessageIds);
      case "worker_complete":
        return await handleWorkerComplete(message, processedLeadSemanticMailboxMessageIds);
      case "final_reconciliation":
        return await handleFinalReconciliation(message, processedLeadSemanticMailboxMessageIds);
      default:
        return false;
    }
  };

  const handleLeadMailboxMessage = async (message: MailboxMessage): Promise<boolean> => {
    if (input.dispatchMode !== "teamlead_chat") {
      return false;
    }

    switch (message.kind) {
      case "evaluator_verdict":
        return await handleEvaluatorVerdict(message, processedLeadMailboxMessageIds);
      case "revision_request":
        return await handleRevisionRequest(message);
      case "shutdown_request":
        return await handleShutdownRequest(message);
      case "spawn_request":
        return await handleSpawnRequest(message, processedLeadMailboxMessageIds);
      case "worker_complete":
        return await handleWorkerComplete(message, processedLeadMailboxMessageIds);
      case "shutdown_response":
        return await handleShutdownResponse(message);
      case "final_reconciliation":
        return await handleFinalReconciliation(message, processedLeadMailboxMessageIds);
      default:
        return false;
    }
  };

  return {
    handleLeadSemanticMailboxMessage,
    handleLeadMailboxMessage,
    autoRespondToPlanApproval,
    postSpawnRequest,
    postFinalReconciliation,
    finalReconciliationPromise,
    rejectFinalReconciliation,
  };
}
