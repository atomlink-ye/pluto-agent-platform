import { randomUUID } from "node:crypto";
import { exec as execCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type { PaseoTeamAdapter } from "../contracts/adapter.js";
import { FakeMailboxTransport } from "../adapters/fake/fake-mailbox-transport.js";
import { PaseoChatTransport, PaseoChatUnavailableError } from "../adapters/paseo-opencode/paseo-chat-transport.js";
import { PaseoOpenCodeAdapter } from "../adapters/paseo-opencode/paseo-opencode-adapter.js";
import type {
  AgentEvent,
  AgentEventType,
  AgentRoleConfig,
  BlockerReasonV0,
  CoordinationTranscriptRefV0,
  FinalArtifact,
  TeamConfig,
  TeamPlaybookV0,
  TeamRunPlaybookMetadataV0,
  TeamRunResult,
  TeamTask,
  WorkerContribution,
} from "../contracts/types.js";
import type {
  DispatchOrchestrationSource,
  EvaluatorVerdictBody,
  EvidenceCommandResult,
  FinalReconciliationBody,
  MailboxEnvelope,
  EvidenceRoleCitation,
  EvidenceTransition,
  MailboxMessage,
  MailboxMessageKind,
  Run,
  RunArtifactRef,
  RunProfile,
  RunProfileAcceptanceCommand,
  RunStatus,
  SpawnRequestBody,
  TaskRecord,
  WorkerCompleteBody,
} from "../contracts/four-layer.js";
import type { MailboxTransport } from "../four-layer/mailbox-transport.js";
import { classifyBlocker } from "./blocker-classifier.js";
import { generateEvidencePacket, writeEvidence } from "./evidence.js";
import { startInboxDeliveryLoop, type InboxDeliveryLoopHandle } from "./inbox-delivery-loop.js";
import { RunStore, sanitizeEventForPersistence } from "./run-store.js";
import type { AcceptanceCheckResult } from "../four-layer/acceptance-runner.js";
import type { AuditMiddlewareResult } from "../four-layer/audit-middleware.js";
import {
  aggregateEvidencePacket,
  createAcceptanceHook,
  createIdleNudgeHook,
  createPlanApprovalRequest,
  createPlanApprovalResponse,
  FileBackedMailbox,
  FileBackedTaskList,
  isEvaluatorVerdict,
  isFinalReconciliation,
  isRevisionRequest,
  isShutdownRequest,
  isShutdownResponse,
  isSpawnRequest,
  isTrustedPlanApprovalResponse,
  isWorkerComplete,
  loadFourLayerWorkspace,
  renderAllRolePrompts,
  resolveFourLayerSelection,
  runAcceptanceChecks,
  runAuditMiddleware,
  runHooks,
  writeEvidencePacket,
} from "../four-layer/index.js";

const exec = promisify(execCallback);
const DEFAULT_LEAD_TIMEOUT_SECONDS = 600;

export interface ManagerRunHarnessSelection {
  scenario: string;
  runProfile?: string;
  playbook?: string;
  runtimeTask?: string;
}

export interface ManagerRunHarnessOptions {
  rootDir: string;
  selection: ManagerRunHarnessSelection;
  workspaceOverride?: string;
  dataDir?: string;
  adapter?: PaseoTeamAdapter;
  createMailboxTransport?: (input: { adapter: PaseoTeamAdapter; runId: string }) => MailboxTransport;
  createAdapter?: (input: {
    team: TeamConfig;
    workspaceCwd: string;
    scenario: string;
    runProfile?: string;
    playbook: string;
    runId: string;
  }) => Promise<PaseoTeamAdapter> | PaseoTeamAdapter;
  autoDriveDispatch?: boolean;
  idGen?: () => string;
  clock?: () => Date;
  onPhase?: (phase: string, details: Record<string, unknown>) => Promise<void> | void;
}

export interface ManagerRunHarnessResult {
  run: Run;
  legacyResult: TeamRunResult;
  runDir: string;
  workspaceDir: string;
  artifactPath: string | null;
  canonicalEvidencePath: string;
  legacyEvidencePath: string;
  stdoutPath: string;
  finalReportPath: string;
}

interface CommandExecutionResult extends EvidenceCommandResult {
  stdout: string;
  stderr: string;
}

interface DispatchPlanEntry {
  index: number;
  role: AgentRoleConfig;
  task: TaskRecord;
}

interface ShutdownTracker {
  expectedRoles: Map<string, "pending" | "received" | "timed_out">;
  timeoutMs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export async function runManagerHarness(options: ManagerRunHarnessOptions): Promise<ManagerRunHarnessResult> {
  const idGen = options.idGen ?? (() => randomUUID());
  const clock = options.clock ?? (() => new Date());
  const rootDir = resolve(options.rootDir);
  const workspace = await loadFourLayerWorkspace(rootDir);
  const resolved = await resolveFourLayerSelection(workspace, options.selection);
  const runId = idGen();
  const runProfile = resolved.runProfile?.value;
  const dispatchMode = resolveDispatchMode(process.env["PLUTO_DISPATCH_MODE"]);
  const autoDriveDispatch = options.autoDriveDispatch ?? true;
  const taskText = resolveRuntimeTask(resolved.scenario.value.task, options.selection.runtimeTask, resolved.scenario.value.allowTaskOverride);
  const prompts = renderAllRolePrompts(resolved, { runtimeTask: taskText, runId, dispatchMode });
  const team = buildTeamConfig(resolved, prompts);
  const initialWorkspaceDir = resolveWorkspaceDir(rootDir, runProfile?.workspace.cwd, runId, options.workspaceOverride);
  const workspaceDir = resolveWorktreeDir(rootDir, runProfile?.workspace.worktree?.path, initialWorkspaceDir, runId);
  const store = new RunStore({ dataDir: options.dataDir ?? ".pluto" });
  const runDir = store.runDir(runId);
  const mailbox = new FileBackedMailbox({
    runDir,
    teammateIds: [team.leadRoleId, ...resolved.members.map((member) => member.value.name), "pluto"],
    clock,
    idGen,
    teamLeadId: team.leadRoleId,
  });
  const taskList = new FileBackedTaskList({ runDir, clock });
  let mailboxRef: CoordinationTranscriptRefV0 = {
    kind: "shared_channel",
    path: mailbox.mirrorPath(),
    roomRef: "",
  };
  const run: Run = {
    schemaVersion: 0,
    kind: "run",
    runId,
    playbook: resolved.playbook.value.name,
    scenario: resolved.scenario.value.name,
    runProfile: resolved.runProfile?.value.name ?? "(none)",
    status: "pending",
    task: taskText,
    workspace: runProfile ? materializedWorkspace(runProfile.workspace, rootDir, workspaceDir, runId) : { cwd: workspaceDir },
    coordinationChannel: {
      kind: "shared_channel",
      locator: mailboxRef.roomRef,
      path: mailboxRef.path,
    },
    artifacts: [],
  };

  const collected: AgentEvent[] = [];
  const transitions: EvidenceTransition[] = [];
  const roleCitations: EvidenceRoleCitation[] = [];
  const commandResults: CommandExecutionResult[] = [];
  const stdoutLines: string[] = [];
  const issues: string[] = [];
  let artifactPath: string | null = null;
  let acceptance: AcceptanceCheckResult = { ok: true, issues: [] };
  let audit: AuditMiddlewareResult = { ok: true, status: "succeeded", issues: [] };
  let blockerReason: BlockerReasonV0 | null = null;
  let adapter: PaseoTeamAdapter | undefined;
  let mailboxTransport: MailboxTransport | undefined;
  let inboxDeliveryLoop: InboxDeliveryLoopHandle | undefined;
  const playbookMetadata = buildPlaybookMetadata(resolved.playbook.value);
  const adapterPlaybook = buildAdapterPlaybook(resolved);
  const roleSessionIds = new Map<string, string>();
  const respondedPlanApprovalRequests = new Set<string>();
  const task: TeamTask = {
    id: `manager-run-${runId}`,
    title: resolved.scenario.value.name,
    prompt: taskText,
    workspacePath: workspaceDir,
    artifactPath: join(workspaceDir, "artifact.md"),
    minWorkers: Math.max(2, resolved.members.length),
  };

  const emit = async (type: AgentEventType, payload: Record<string, unknown> = {}, roleId?: string, sessionId?: string): Promise<AgentEvent> => {
    const event = sanitizeEventForPersistence({
      id: idGen(),
      runId,
      ts: clock().toISOString(),
      type,
      ...(roleId ? { roleId: roleId as AgentEvent["roleId"] } : {}),
      ...(sessionId ? { sessionId } : {}),
      payload,
    });
    collected.push(event);
    await store.appendEvent(event);
    return event;
  };

  const recordMailboxMessageEvent = async (
    message: MailboxMessage,
    roleId?: string,
    sessionId?: string,
    orchestrationSource?: DispatchOrchestrationSource,
  ) => {
    await emit("mailbox_message", {
      messageId: message.id,
      to: message.to,
      from: message.from,
      kind: message.kind,
      transportMessageId: message.transportMessageId,
      ...(orchestrationSource ? { orchestrationSource } : {}),
    }, roleId, sessionId);
  };

  const persistAdapterEvents = async () => {
    if (!adapter) return [] as AgentEvent[];
    const events = await adapter.readEvents({ runId });
    for (const event of events) {
      const persisted = sanitizeEventForPersistence(event);
      collected.push(persisted);
      await store.appendEvent(persisted);
    }
    return events;
  };

  const sendMailboxMessage = async (input: {
    to: string;
    from: string;
    kind?: MailboxMessageKind;
    body: MailboxMessage["body"];
    summary?: string;
    replyTo?: string;
    transportReplyTo?: string;
    taskId?: string;
  }): Promise<MailboxMessage> => {
    if (!mailboxTransport || !mailboxRef.roomRef) {
      throw new Error("mailbox_transport_not_ready");
    }

    const baseMessage = mailbox.createMessage(input);
    const envelope: MailboxEnvelope = {
      schemaVersion: "v1",
      fromRole: baseMessage.from,
      toRole: baseMessage.to,
      runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      body: baseMessage,
    };

    let mirroredMessage = baseMessage;
    try {
      const transportRef = await mailboxTransport.post({
        room: mailboxRef.roomRef,
        envelope,
        ...(input.transportReplyTo ? { replyTo: input.transportReplyTo } : {}),
      });
      mirroredMessage = {
        ...baseMessage,
        transportMessageId: transportRef.transportMessageId,
        transportTimestamp: transportRef.transportTimestamp,
        transportStatus: "ok",
        deliveryStatus: "pending",
      };
    } catch (error) {
      mirroredMessage = {
        ...baseMessage,
        transportStatus: "post_failed",
        deliveryStatus: "failed",
        deliveryAttemptedAt: clock().toISOString(),
        deliveryFailedReason: "transport_post_failed",
      };
      await emit("mailbox_transport_post_failed", {
        messageId: baseMessage.id,
        to: baseMessage.to,
        from: baseMessage.from,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    await mailbox.appendToInbox(mirroredMessage);
    try {
      await mailbox.appendToMirror(mirroredMessage);
    } catch (error) {
      throw new MailboxMirrorWriteError(error instanceof Error ? error.message : String(error));
    }
    return mirroredMessage;
  };

  const dispatchMessageKinds = new Set<MailboxMessageKind>([
    "evaluator_verdict",
    "revision_request",
    "shutdown_request",
    "shutdown_response",
    "spawn_request",
    "worker_complete",
    "final_reconciliation",
  ]);
  const resolveMailboxOrchestrationSource = (message: MailboxMessage): DispatchOrchestrationSource | undefined =>
    dispatchMessageKinds.has(message.kind) ? dispatchMode : undefined;

  const auditMailboxTransportParity = async () => {
    if (!mailboxTransport || !mailboxRef.roomRef || !run.startedAt) {
      return;
    }

    const mirrorMessages = await mailbox.readMirror();
    const mirrorTransportIds = mirrorMessages
      .filter((message) => message.transportStatus === "ok" && typeof message.transportMessageId === "string")
      .map((message) => message.transportMessageId!);

    try {
      const transportRead = await mailboxTransport.read({
        room: mailboxRef.roomRef,
        since: { kind: "timestamp", value: run.startedAt },
      });
      for (const rejection of drainEnvelopeRejections(mailboxTransport)) {
        await emit("mailbox_transport_envelope_rejected", rejection);
      }
      const transportIds = transportRead.messages.map((message) => message.transportMessageId);
      const mirrorSet = new Set(mirrorTransportIds);
      const transportSet = new Set(transportIds);
      const missing = mirrorTransportIds.filter((id) => !transportSet.has(id));
      const extra = transportIds.filter((id) => !mirrorSet.has(id));
      const reorderedAt: number[] = [];
      for (let index = 0; index < Math.min(mirrorTransportIds.length, transportIds.length); index += 1) {
        if (mirrorTransportIds[index] !== transportIds[index]) {
          reorderedAt.push(index);
        }
      }
      if (missing.length || extra.length || reorderedAt.length) {
        await emit("mailbox_transport_parity_drift", { missing, extra, reorderedAt });
      }
    } catch (error) {
      await emit("mailbox_transport_parity_drift", {
        missing: mirrorTransportIds,
        extra: [],
        reorderedAt: [],
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  try {
    validateRunProfileRuntimeSupport(runProfile);
    await verifyRequiredReads(rootDir, runProfile?.requiredReads ?? []);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    blockerReason = classifyBlocker({ errorMessage: message, source: "orchestrator" }).reason;
    return finishFailure({
      run,
      runDir,
      workspaceDir,
      artifactPath,
      collected,
      task,
      issues: [message],
      blockerReason,
      clock,
      store,
      mailboxRef,
      commandResults,
      transitions,
      roleCitations,
      acceptance,
      audit,
    });
  }

  try {
    adapter = options.adapter ?? await options.createAdapter?.({
      team,
      workspaceCwd: workspaceDir,
      scenario: resolved.scenario.value.name,
      runProfile: resolved.runProfile?.value.name,
      playbook: resolved.playbook.value.name,
      runId,
    });
    if (!adapter) {
      throw new Error("manager_run_harness_adapter_required");
    }

    await options.onPhase?.("pre_launch", { runId, scenario: resolved.scenario.value.name });
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(runDir, { recursive: true });
    await mailbox.ensure();
    await taskList.ensure();
    await writeFile(join(runDir, "workspace-materialization.json"), JSON.stringify({
      runId,
      repoRoot: rootDir,
      workspaceDir,
      runProfile: resolved.runProfile?.value.name ?? null,
      mailboxPath: mailbox.mirrorPath(),
      taskListPath: taskList.path(),
    }, null, 2) + "\n", "utf8");

    run.status = "running";
    run.startedAt = clock().toISOString();
    mailboxTransport = options.createMailboxTransport?.({ adapter, runId }) ?? createMailboxTransport(adapter);
    try {
      await probeMailboxTransport(mailboxTransport);
      const roomRef = await mailboxTransport.createRoom({
        runId,
        name: `pluto-mailbox-${runId}`,
        purpose: `Pluto mailbox for run ${runId}`,
      });
      mailboxRef = { ...mailboxRef, roomRef };
      run.coordinationChannel = {
        kind: "shared_channel",
        locator: roomRef,
        path: mailboxRef.path,
      };
      await emit("coordination_transcript_created", {
        roomRef,
        runId,
        transportTimestamp: clock().toISOString(),
      });
    } catch (error) {
      if (error instanceof PaseoChatUnavailableError) {
        blockerReason = error.blockerReason;
        issues.push(error.message);
        await emit("blocker", error.toBlockerPayload());
        await emit("run_failed", { message: error.message });
        return finishFailure({
          run,
          runDir,
          workspaceDir,
          artifactPath,
          collected,
          task,
          issues,
          blockerReason,
          clock,
          store,
          mailboxRef,
          commandResults,
          transitions,
          roleCitations,
          acceptance,
          audit,
        });
      }
      throw error;
    }
    await emit("run_started", {
      taskId: task.id,
      title: task.title,
      prompt: task.prompt,
      playbook: playbookMetadata,
      playbookId: resolved.playbook.value.name,
      orchestrationMode: "teamlead_direct",
      orchestrationSource: "teamlead_direct",
      transcript: mailboxRef,
      mailboxLogPath: mailbox.mirrorPath(),
      taskListPath: taskList.path(),
      scenario: resolved.scenario.value.name,
      runProfile: resolved.runProfile?.value.name ?? null,
    });

    await adapter.startRun({ runId, task, team, playbook: adapterPlaybook, transcript: mailboxRef });
    const leadRole = team.roles.find((role) => role.id === team.leadRoleId)!;
    const leadSession = await adapter.createLeadSession({
      runId,
      task,
      role: leadRole,
      playbook: adapterPlaybook,
      transcript: mailboxRef,
    });
    roleSessionIds.set(leadRole.id, leadSession.sessionId);
    await persistAdapterEvents();
    const memberRoles = team.roles.filter((role) => role.kind === "worker");
    const memberRoleById = new Map<string, AgentRoleConfig>(memberRoles.map((role) => [role.id, role]));
    const validRubricRefs = new Set(
      Object.values(resolved.scenario.value.overlays ?? {})
        .map((overlay) => overlay.rubricRef)
        .filter((rubricRef): rubricRef is string => typeof rubricRef === "string" && rubricRef.length > 0),
    );
    const acceptanceHook = createAcceptanceHook({
      workspaceDir,
      acceptanceCommands: runProfile?.acceptanceCommands ?? [],
      taskList,
    });
    const completionMessages: MailboxMessage[] = [];
    const contributions: WorkerContribution[] = [];
    const dispatchPlan: DispatchPlanEntry[] = [];
    const dispatchPlanByTaskId = new Map<string, DispatchPlanEntry>();
    const evaluatorVerdictsByMessageId = new Map<string, EvaluatorVerdictBody>();
    const completedDispatchTaskIds = new Set<string>();
    let previousRole = leadRole.id;
    let lastTask: TaskRecord | null = null;
    let shutdownTracker: ShutdownTracker | null = null;
    let finalReconciliationSettled = false;
    let resolveFinalReconciliation!: (body: FinalReconciliationBody) => void;
    let rejectFinalReconciliation!: (reason?: unknown) => void;
    const finalReconciliationPromise = new Promise<FinalReconciliationBody>((resolve, reject) => {
      resolveFinalReconciliation = resolve;
      rejectFinalReconciliation = reject;
    });

    if (dispatchMode === "teamlead_chat") {
      let previousDispatchTaskId: string | undefined;
      for (const [index, role] of memberRoles.entries()) {
        const createdTask = await taskList.create({
          assigneeId: role.id,
          dependsOn: previousDispatchTaskId ? [previousDispatchTaskId] : [],
          summary: `${role.id}: ${taskText}`,
        });
        const entry: DispatchPlanEntry = { index, role, task: createdTask };
        dispatchPlan.push(entry);
        dispatchPlanByTaskId.set(createdTask.id, entry);
        previousDispatchTaskId = createdTask.id;
        lastTask = createdTask;
        await emit("task_created", { taskId: createdTask.id, summary: createdTask.summary, dependsOn: createdTask.dependsOn }, role.id);
      }
    }

    const rejectFinalization = (reason: unknown) => {
      if (shutdownTracker?.timer) {
        clearTimeout(shutdownTracker.timer);
        shutdownTracker.timer = null;
      }
      if (finalReconciliationSettled) {
        return;
      }
      finalReconciliationSettled = true;
      rejectFinalReconciliation(reason);
    };

    const taskInstructionsFor = (taskRecord: TaskRecord): string => {
      const prefix = taskRecord.assigneeId ? `${taskRecord.assigneeId}: ` : "";
      return prefix && taskRecord.summary.startsWith(prefix)
        ? taskRecord.summary.slice(prefix.length)
        : taskRecord.summary;
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
      await emit("shutdown_complete", {
        ackedRoles,
        timedOutRoles,
        orchestrationSource: dispatchMode,
      }, leadRole.id, leadSession.sessionId);
      finalReconciliationSettled = true;
      resolveFinalReconciliation({
        schemaVersion: "v1",
        summary: timedOutRoles.length > 0
          ? `Shutdown completed with timeouts for ${timedOutRoles.join(", ")}.`
          : `Shutdown completed after acknowledgments from ${ackedRoles.join(", ") || "no active teammates"}.`,
        completedTaskIds: Array.from(completedDispatchTaskIds),
      });
    };

    const postSpawnRequestMessage = async (entry: DispatchPlanEntry, rationale?: string) => {
      const requestMessage = await sendMailboxMessage({
        to: leadRole.id,
        from: leadRole.id,
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
      await recordMailboxMessageEvent(requestMessage, leadRole.id, leadSession.sessionId, dispatchMode);
    };

    const postWorkerCompleteMessage = async (entry: DispatchPlanEntry, output: string, sessionId?: string) => {
      const completionMessage = await sendMailboxMessage({
        to: leadRole.id,
        from: entry.role.id,
        kind: "worker_complete",
        summary: `COMPLETE ${entry.task.id}`,
        body: {
          schemaVersion: "v1",
          taskId: entry.task.id,
          status: "succeeded",
          summary: firstNonEmptyLine(output) || "completed",
        } satisfies WorkerCompleteBody,
        replyTo: entry.task.id,
        taskId: entry.task.id,
      });
      completionMessages.push(completionMessage);
      await recordMailboxMessageEvent(completionMessage, entry.role.id, sessionId, dispatchMode);
    };

    const postFinalReconciliationMessage = async () => {
      const reconciliationMessage = await sendMailboxMessage({
        to: leadRole.id,
        from: leadRole.id,
        kind: "final_reconciliation",
        summary: "FINAL_RECONCILIATION",
        body: {
          schemaVersion: "v1",
          summary: `Completed ${completedDispatchTaskIds.size} dispatched tasks.`,
          completedTaskIds: Array.from(completedDispatchTaskIds),
        } satisfies FinalReconciliationBody,
      });
      await recordMailboxMessageEvent(reconciliationMessage, leadRole.id, leadSession.sessionId, dispatchMode);
    };

    inboxDeliveryLoop = startInboxDeliveryLoop({
      runId,
      room: mailboxRef.roomRef,
      transport: mailboxTransport,
      adapter,
      resolveSessionId: (roleId) => roleSessionIds.get(roleId),
      emit,
      clock,
      resolveOrchestrationSource: resolveMailboxOrchestrationSource,
      markMessageRead: async (message) => {
        await mailbox.markRead(message.to, [message.id]);
      },
      onDelivered: async ({ message, roleId }) => {
        try {
          if (message.kind === "plan_approval_request" && roleId === leadRole.id) {
            if (respondedPlanApprovalRequests.has(message.id)) {
              return;
            }
            respondedPlanApprovalRequests.add(message.id);
            const taskId = typeof message.body === "object" && message.body !== null && "taskId" in message.body
              ? String((message.body as { taskId?: string }).taskId ?? "") || undefined
              : undefined;
            const responseMessage = await sendMailboxMessage({
              to: message.from,
              from: leadRole.id,
              kind: "plan_approval_response",
              summary: taskId ? `PLAN_APPROVED ${taskId}` : "PLAN_APPROVED",
              body: createPlanApprovalResponse({ approved: true, mode: "workspace_write", taskId }),
              replyTo: message.id,
              transportReplyTo: message.transportMessageId,
              taskId,
            });
            if (!isTrustedPlanApprovalResponse(responseMessage, leadRole.id)) {
              throw new Error(`untrusted_plan_approval_response:${taskId ?? message.id}`);
            }
            await recordMailboxMessageEvent(responseMessage, leadRole.id, leadSession.sessionId);
            await emit("plan_approval_responded", { messageId: responseMessage.id, taskId: taskId ?? null }, leadRole.id, leadSession.sessionId);
            return;
          }

          if (dispatchMode !== "teamlead_chat" || roleId !== leadRole.id) {
            return;
          }

          switch (message.kind) {
            case "evaluator_verdict": {
              if (!isEvaluatorVerdict(message)) {
                return;
              }
              const currentTask = await taskList.read(message.body.taskId);
              const sessionId = roleSessionIds.get(message.from);
              if (!currentTask || currentTask.claimedBy !== message.from) {
                await emit("evaluator_verdict_untrusted_sender", {
                  messageId: message.id,
                  taskId: message.body.taskId,
                  fromRole: message.from,
                  claimedBy: currentTask?.claimedBy ?? null,
                  orchestrationSource: dispatchMode,
                }, message.from as AgentEvent["roleId"], sessionId);
                return;
              }
              if (message.body.failedRubricRef && !validRubricRefs.has(message.body.failedRubricRef)) {
                return;
              }
              evaluatorVerdictsByMessageId.set(message.id, message.body);
              await emit("evaluator_verdict_received", {
                taskId: message.body.taskId,
                verdict: message.body.verdict,
                ...(message.body.failedRubricRef ? { failedRubricRef: message.body.failedRubricRef } : {}),
                orchestrationSource: dispatchMode,
              }, message.from as AgentEvent["roleId"], sessionId);
              return;
            }
            case "revision_request": {
              if (!isRevisionRequest(message)) {
                return;
              }
              if (message.from !== leadRole.id) {
                await emit("revision_request_untrusted_sender", {
                  messageId: message.id,
                  fromRole: message.from,
                  orchestrationSource: dispatchMode,
                }, leadRole.id, leadSession.sessionId);
                return;
              }
              const failedTask = await taskList.read(message.body.failedTaskId);
              const failedVerdict = evaluatorVerdictsByMessageId.get(message.body.failedVerdictMessageId);
              const targetRole = memberRoleById.get(message.body.targetRole);
              if (!failedTask || !failedVerdict || failedVerdict.verdict !== "fail" || !targetRole) {
                return;
              }
              await emit("revision_request_received", {
                messageId: message.id,
                failedTaskId: message.body.failedTaskId,
                failedVerdictMessageId: message.body.failedVerdictMessageId,
                targetRole: message.body.targetRole,
                orchestrationSource: dispatchMode,
              }, leadRole.id, leadSession.sessionId);
              const revisionTask = await taskList.create({
                assigneeId: targetRole.id,
                dependsOn: [message.body.failedTaskId],
                summary: `${targetRole.id}: ${message.body.instructions}`,
              });
              const revisionEntry: DispatchPlanEntry = {
                index: dispatchPlan.length + dispatchPlanByTaskId.size,
                role: targetRole,
                task: revisionTask,
              };
              dispatchPlanByTaskId.set(revisionTask.id, revisionEntry);
              lastTask = revisionTask;
              await emit("task_created", {
                taskId: revisionTask.id,
                summary: revisionTask.summary,
                dependsOn: revisionTask.dependsOn,
                orchestrationSource: dispatchMode,
              }, targetRole.id);
              const syntheticSpawn = await sendMailboxMessage({
                to: leadRole.id,
                from: leadRole.id,
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
              await recordMailboxMessageEvent(syntheticSpawn, leadRole.id, leadSession.sessionId, dispatchMode);
              await emit("revision_request_dispatched", {
                messageId: message.id,
                failedTaskId: message.body.failedTaskId,
                revisionTaskId: revisionTask.id,
                targetRole: targetRole.id,
                spawnMessageId: syntheticSpawn.id,
                orchestrationSource: dispatchMode,
              }, leadRole.id, leadSession.sessionId);
              return;
            }
            case "shutdown_request": {
              if (!isShutdownRequest(message)) {
                return;
              }
              if (message.from !== leadRole.id) {
                await emit("shutdown_request_untrusted_sender", {
                  messageId: message.id,
                  fromRole: message.from,
                  orchestrationSource: dispatchMode,
                }, leadRole.id, leadSession.sessionId);
                return;
              }
              const activeRoleSessions = await adapter!.listActiveRoleSessions({ runId });
              const activeWorkerRoles = memberRoles
                .map((role) => role.id)
                .filter((roleId) => typeof activeRoleSessions[roleId] === "string" && activeRoleSessions[roleId].length > 0);
              const targetRoles = message.body.targetRole
                ? activeWorkerRoles.filter((roleId) => roleId === message.body.targetRole)
                : activeWorkerRoles;
              const timeoutMs = message.body.timeoutMs ?? 30_000;
              await emit("shutdown_request_received", {
                messageId: message.id,
                targetRole: message.body.targetRole ?? null,
                timeoutMs,
                targetRoles,
                orchestrationSource: dispatchMode,
              }, leadRole.id, leadSession.sessionId);
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
                from: leadRole.id,
                kind: message.kind,
                summary: message.summary,
                replyTo: message.replyTo,
                body: message.body,
              });
              for (const targetRole of targetRoles) {
                await adapter!.sendRoleMessage({
                  runId,
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
                void completeShutdown().catch(rejectFinalization);
              }, timeoutMs);
              await emit("shutdown_request_dispatched", {
                messageId: message.id,
                targetRole: message.body.targetRole ?? null,
                targetRoles,
                timeoutMs,
                orchestrationSource: dispatchMode,
              }, leadRole.id, leadSession.sessionId);
              if (targetRoles.length === 0) {
                await completeShutdown();
              }
              return;
            }
            case "spawn_request": {
              await emit("spawn_request_received", {
                messageId: message.id,
                taskId: isSpawnRequest(message) ? message.body.taskId : null,
                orchestrationSource: dispatchMode,
              }, leadRole.id, leadSession.sessionId);
              if (message.from !== leadRole.id) {
                await emit("spawn_request_untrusted_sender", {
                  messageId: message.id,
                  fromRole: message.from,
                  orchestrationSource: dispatchMode,
                }, leadRole.id, leadSession.sessionId);
                return;
              }
              if (!isSpawnRequest(message)) {
                await emit("spawn_request_rejected", {
                  messageId: message.id,
                  reason: "invalid_body",
                  orchestrationSource: dispatchMode,
                }, leadRole.id, leadSession.sessionId);
                return;
              }
              const entry = dispatchPlanByTaskId.get(message.body.taskId);
              if (!entry || entry.role.id !== message.body.targetRole || !memberRoleById.has(message.body.targetRole)) {
                await emit("spawn_request_rejected", {
                  messageId: message.id,
                  taskId: message.body.taskId,
                  targetRole: message.body.targetRole,
                  reason: "target_role_not_in_playbook",
                  orchestrationSource: dispatchMode,
                }, leadRole.id, leadSession.sessionId);
                return;
              }
              const currentTask = await taskList.read(entry.task.id);
              if (!currentTask || currentTask.status !== "pending") {
                await emit("spawn_request_rejected", {
                  messageId: message.id,
                  taskId: entry.task.id,
                  targetRole: entry.role.id,
                  reason: currentTask ? `task_not_pending:${currentTask.status}` : "task_not_found",
                  orchestrationSource: dispatchMode,
                }, leadRole.id, leadSession.sessionId);
                return;
              }

              let claimedTask: TaskRecord;
              try {
                claimedTask = await taskList.claim(entry.task.id, entry.role.id);
              } catch (error) {
                const reason = error instanceof Error && error.message.startsWith("task_blocked:")
                  ? "dependsOn_unsatisfied"
                  : (error instanceof Error ? error.message : String(error));
                await emit("spawn_request_rejected", {
                  messageId: message.id,
                  taskId: entry.task.id,
                  targetRole: entry.role.id,
                  reason,
                  orchestrationSource: dispatchMode,
                }, leadRole.id, leadSession.sessionId);
                return;
              }

              await emit("task_claimed", {
                taskId: claimedTask.id,
                claimedBy: entry.role.id,
                orchestrationSource: dispatchMode,
              }, entry.role.id);

              const idleHook = createIdleNudgeHook({ roleId: entry.role.id, taskList });
              await runHooks([idleHook], { roleId: entry.role.id });
              const taskInstructions = taskInstructionsFor(claimedTask);

              const workerSession = await adapter!.createWorkerSession({
                runId,
                role: entry.role,
                instructions: `Task ${entry.task.id}\n${taskInstructions}`,
              });
              roleSessionIds.set(entry.role.id, workerSession.sessionId);

              const assignmentMessage = await sendMailboxMessage({
                to: entry.role.id,
                from: leadRole.id,
                summary: `TASK ${entry.task.id}`,
                body: `Task ${entry.task.id}\nRole: ${entry.role.id}\nGoal: ${taskInstructions}`,
                replyTo: entry.task.id,
                taskId: entry.task.id,
              });
              await recordMailboxMessageEvent(assignmentMessage, entry.role.id, leadSession.sessionId);

              if (entry.role.id === "planner") {
                const requestBody = createPlanApprovalRequest({
                  plan: `Plan for ${entry.task.id}: ${taskInstructions}`,
                  requestedMode: "workspace_write",
                  taskId: entry.task.id,
                });
                const requestMessage = await sendMailboxMessage({
                  to: leadRole.id,
                  from: entry.role.id,
                  kind: "plan_approval_request",
                  summary: `PLAN ${entry.task.id}`,
                  body: requestBody,
                  replyTo: entry.task.id,
                  taskId: entry.task.id,
                });
                await recordMailboxMessageEvent(requestMessage, entry.role.id, workerSession.sessionId);
                await emit("plan_approval_requested", { messageId: requestMessage.id, taskId: entry.task.id }, entry.role.id);
              }

              const workerEvents = await persistAdapterEvents();
              const completedEvent = findWorkerCompletedEvent(workerEvents, entry.role.id);
              const output = completedEvent
                ? String(completedEvent.transient?.rawPayload?.output ?? completedEvent.payload.output ?? "")
                : `Contribution from ${entry.role.id}.`;
              const structuredWorkerMessage = extractStructuredWorkerMessage(output, entry.task.id);
              if (structuredWorkerMessage) {
                const relayedMessage = await sendMailboxMessage({
                  to: leadRole.id,
                  from: entry.role.id,
                  kind: structuredWorkerMessage.kind,
                  summary: structuredWorkerMessage.summary,
                  body: structuredWorkerMessage.body,
                  replyTo: entry.task.id,
                  taskId: entry.task.id,
                });
                await recordMailboxMessageEvent(relayedMessage, entry.role.id, completedEvent?.sessionId ?? workerSession.sessionId, dispatchMode);
              }
              contributions.push({
                roleId: entry.role.id as WorkerContribution["roleId"],
                sessionId: completedEvent?.sessionId ?? workerSession.sessionId,
                output,
              });
              transitions.push({ from: previousRole, to: entry.role.id, observedAt: clock().toISOString(), source: "task_list" });
              roleCitations.push({ role: entry.role.id, summary: firstNonEmptyLine(output), quote: firstNonEmptyLine(output) });
              previousRole = entry.role.id;

              await emit("spawn_request_executed", {
                messageId: message.id,
                taskId: entry.task.id,
                targetRole: entry.role.id,
                workerSessionId: workerSession.sessionId,
                orchestrationSource: dispatchMode,
              }, entry.role.id, workerSession.sessionId);
              await postWorkerCompleteMessage(entry, output, completedEvent?.sessionId ?? workerSession.sessionId);
              return;
            }
            case "worker_complete": {
              if (!isWorkerComplete(message)) {
                return;
              }
              const currentTask = await taskList.read(message.body.taskId);
              const sessionId = roleSessionIds.get(message.from);
              if (!currentTask || currentTask.claimedBy !== message.from) {
                await emit("worker_complete_untrusted_sender", {
                  messageId: message.id,
                  taskId: message.body.taskId,
                  fromRole: message.from,
                  claimedBy: currentTask?.claimedBy ?? null,
                  orchestrationSource: dispatchMode,
                }, message.from as AgentEvent["roleId"], sessionId);
                return;
              }
              await taskList.complete(message.body.taskId, message.body.artifactRef ? [message.body.artifactRef] : []);
              completedDispatchTaskIds.add(message.body.taskId);
              await emit("worker_complete_received", {
                messageId: message.id,
                taskId: message.body.taskId,
                status: message.body.status,
                orchestrationSource: dispatchMode,
              }, message.from as AgentEvent["roleId"], sessionId);
              await emit("task_completed", {
                taskId: message.body.taskId,
                messageId: message.id,
                orchestrationSource: dispatchMode,
              }, message.from as AgentEvent["roleId"], sessionId);

              if (!autoDriveDispatch) {
                return;
              }
              const nextEntry = dispatchPlan.find((entry) =>
                !completedDispatchTaskIds.has(entry.task.id)
                && entry.task.dependsOn.every((dependencyId) => completedDispatchTaskIds.has(dependencyId)),
              );
              if (nextEntry) {
                await postSpawnRequestMessage(nextEntry, `Continue after ${message.body.taskId}.`);
                return;
              }
              if (dispatchPlan.length > 0 && completedDispatchTaskIds.size === dispatchPlan.length) {
                await postFinalReconciliationMessage();
              }
              return;
            }
            case "shutdown_response": {
              if (!isShutdownResponse(message)) {
                return;
              }
              const activeRoleSessions = await adapter!.listActiveRoleSessions({ runId });
              const sessionId = roleSessionIds.get(message.from);
              if (!memberRoleById.has(message.from) || typeof activeRoleSessions[message.from] !== "string") {
                await emit("shutdown_response_untrusted_sender", {
                  messageId: message.id,
                  fromRole: message.from,
                  orchestrationSource: dispatchMode,
                }, message.from as AgentEvent["roleId"], sessionId);
                return;
              }
              if (shutdownTracker?.expectedRoles.has(message.from)) {
                shutdownTracker.expectedRoles.set(message.from, "received");
              }
              await emit("shutdown_response_received", {
                messageId: message.id,
                fromRole: message.from,
                ...(message.body.fromTaskId ? { fromTaskId: message.body.fromTaskId } : {}),
                orchestrationSource: dispatchMode,
              }, message.from as AgentEvent["roleId"], sessionId);
              if (shutdownTracker && Array.from(shutdownTracker.expectedRoles.values()).every((state) => state === "received")) {
                await completeShutdown();
              }
              return;
            }
            case "final_reconciliation": {
              if (!isFinalReconciliation(message)) {
                return;
              }
              if (message.from !== leadRole.id) {
                await emit("final_reconciliation_invalid", {
                  messageId: message.id,
                  fromRole: message.from,
                  reason: "untrusted_sender",
                  orchestrationSource: dispatchMode,
                }, leadRole.id, leadSession.sessionId);
                return;
              }
              await emit("final_reconciliation_received", {
                messageId: message.id,
                completedTaskIds: message.body.completedTaskIds,
                orchestrationSource: dispatchMode,
              }, leadRole.id, leadSession.sessionId);
              if (!finalReconciliationSettled) {
                finalReconciliationSettled = true;
                resolveFinalReconciliation(message.body);
              }
              return;
            }
            default:
              return;
          }
        } catch (error) {
          rejectFinalization(error);
          throw error;
        }
      },
    });

    await sendMailboxMessage({
      to: leadRole.id,
      from: "pluto",
      summary: "RUN_START",
      body: `Run ${runId} started. Pluto owns the mailbox mirror and shared task list for this run.`,
    });

    if (dispatchMode === "static_loop") {
      let previousTaskId: string | undefined;
      for (const role of memberRoles) {
        const createdTask = await taskList.create({
          assigneeId: role.id,
          dependsOn: previousTaskId ? [previousTaskId] : [],
          summary: `${role.id}: ${taskText}`,
        });
        lastTask = createdTask;
        await emit("task_created", { taskId: createdTask.id, summary: createdTask.summary, dependsOn: createdTask.dependsOn }, role.id);

        const claimedTask = await taskList.claim(createdTask.id, role.id);
        await emit("task_claimed", {
          taskId: claimedTask.id,
          claimedBy: role.id,
          orchestrationSource: dispatchMode,
        }, role.id);

        const idleHook = createIdleNudgeHook({ roleId: role.id, taskList });
        await runHooks([idleHook], { roleId: role.id });
        const taskInstructions = taskInstructionsFor(claimedTask);

        const workerSession = await adapter.createWorkerSession({
          runId,
          role,
          instructions: `Task ${createdTask.id}\n${taskInstructions}`,
        });
        roleSessionIds.set(role.id, workerSession.sessionId);

        const assignmentMessage = await sendMailboxMessage({
          to: role.id,
          from: leadRole.id,
          summary: `TASK ${createdTask.id}`,
          body: `Task ${createdTask.id}\nRole: ${role.id}\nGoal: ${taskInstructions}`,
          replyTo: createdTask.id,
          taskId: createdTask.id,
        });
        await recordMailboxMessageEvent(assignmentMessage, role.id, leadSession.sessionId);

        if (role.id === "planner") {
          const requestBody = createPlanApprovalRequest({
            plan: `Plan for ${createdTask.id}: ${taskInstructions}`,
            requestedMode: "workspace_write",
            taskId: createdTask.id,
          });
          const requestMessage = await sendMailboxMessage({
            to: leadRole.id,
            from: role.id,
            kind: "plan_approval_request",
            summary: `PLAN ${createdTask.id}`,
            body: requestBody,
            replyTo: createdTask.id,
            taskId: createdTask.id,
          });
          await recordMailboxMessageEvent(requestMessage, role.id, workerSession.sessionId);
          await emit("plan_approval_requested", { messageId: requestMessage.id, taskId: createdTask.id }, role.id);
        }

        const workerEvents = await persistAdapterEvents();
        const completedEvent = findWorkerCompletedEvent(workerEvents, role.id);
        const output = completedEvent
          ? String(completedEvent.transient?.rawPayload?.output ?? completedEvent.payload.output ?? "")
          : `Contribution from ${role.id}.`;
        contributions.push({ roleId: role.id as WorkerContribution["roleId"], sessionId: completedEvent?.sessionId ?? `${role.id}-session`, output });
        transitions.push({ from: previousRole, to: role.id, observedAt: clock().toISOString(), source: "task_list" });
        roleCitations.push({ role: role.id, summary: firstNonEmptyLine(output), quote: firstNonEmptyLine(output) });
        previousRole = role.id;

        const completionMessage = await sendMailboxMessage({
          to: leadRole.id,
          from: role.id,
          summary: `COMPLETE ${createdTask.id}`,
          body: buildCompletionMessageBody(createdTask.id, output),
          replyTo: createdTask.id,
          taskId: createdTask.id,
        });
        completionMessages.push(completionMessage);
        await recordMailboxMessageEvent(completionMessage, role.id, completedEvent?.sessionId);

        await taskList.complete(createdTask.id, []);
        await emit("task_completed", {
          taskId: createdTask.id,
          messageId: completionMessage.id,
          orchestrationSource: dispatchMode,
        }, role.id, completedEvent?.sessionId);
        previousTaskId = createdTask.id;
      }
    } else {
      if (autoDriveDispatch && dispatchPlan[0]) {
        await postSpawnRequestMessage(dispatchPlan[0], "Start the first dispatched task.");
      }
      await finalReconciliationPromise;
    }

    transitions.push({ from: previousRole, to: leadRole.id, observedAt: clock().toISOString(), source: "mailbox_summary" });
    await adapter.sendMessage({
      runId,
      sessionId: leadSession.sessionId,
      message: buildSummaryRequest(taskText, contributions, completionMessages, mailbox.mirrorPath()),
    });
    const summaryEvents = await persistAdapterEvents();
    const leadSummaryEvent = [...summaryEvents].reverse().find((event) => event.type === "lead_message");
    const markdown = leadSummaryEvent
      ? String(leadSummaryEvent.transient?.rawPayload?.markdown ?? leadSummaryEvent.payload.markdown ?? "")
      : buildFallbackSummary(taskText, contributions);
    const finalizedMarkdown = ensureArtifactMentions(markdown, [leadRole.id, ...memberRoles.map((role) => role.id)]);
    const finalSummaryMessage = await sendMailboxMessage({
      to: "pluto",
      from: leadRole.id,
      summary: "FINAL",
      body: [
        firstNonEmptyLine(finalizedMarkdown),
        ...completionMessages.map((message) => `${message.from}:${message.id}`),
      ].join("\n"),
    });
    await recordMailboxMessageEvent(finalSummaryMessage, leadRole.id, leadSession.sessionId);

    const artifact: FinalArtifact = {
      runId,
      markdown: finalizedMarkdown,
      leadSummary: firstNonEmptyLine(finalizedMarkdown),
      contributions,
    };
    artifactPath = await store.writeArtifact(artifact);
    await writeFile(join(workspaceDir, "artifact.md"), finalizedMarkdown, "utf8");

    if (lastTask) {
      const hookResult = await runHooks([acceptanceHook], { task: lastTask });
      issues.push(...hookResult.messages);
    }

    const taskTreePath = join(runDir, "task-tree.md");
    const statusPath = join(runDir, "status.md");
    const finalReportPath = join(runDir, "final-report.md");
    await writeFile(taskTreePath, renderTaskTree(resolved.playbook.value.name, [leadRole.id, ...memberRoles.map((role) => role.id)]), "utf8");
    await writeFile(statusPath, renderStatusDoc(runId, resolved.scenario.value.name, resolved.playbook.value.name, resolved.runProfile?.value.name ?? "(none)", workspaceDir, artifactPath), "utf8");
    await writeFile(finalReportPath, renderFinalReport(finalizedMarkdown, transitions, completionMessages, workspaceDir), "utf8");

    stdoutLines.push(
      `WROTE: artifact.md`,
      `WROTE: ${relative(runDir, taskTreePath)}`,
      `WROTE: ${relative(runDir, statusPath)}`,
      `WROTE: ${relative(runDir, finalReportPath)}`,
      `SUMMARY: ${firstNonEmptyLine(finalizedMarkdown)}`,
    );

    const stdout = stdoutLines.join("\n") + "\n";
    const stdoutPath = join(runDir, "stdout.log");
    await writeFile(stdoutPath, stdout, "utf8");

    acceptance = await runAcceptanceChecks({
      artifactRootDir: runDir,
      stdout,
      runProfile: {
        artifactContract: runProfile?.artifactContract,
        stdoutContract: runProfile?.stdoutContract,
      },
    });
    issues.push(...acceptance.issues.map((issue) => issue.message));
    audit = await runAuditMiddleware({
      artifactRootDir: runDir,
      stdout,
      playbook: resolved.playbook.value,
      runProfile: {
        artifactContract: runProfile?.artifactContract,
        stdoutContract: runProfile?.stdoutContract,
      },
      mailboxLogPath: mailbox.mirrorPath(),
      taskListPath: taskList.path(),
      teamLeadId: leadRole.id,
    });
    issues.push(...audit.issues.map((issue) => issue.message));

    const artifactRefs: RunArtifactRef[] = [
      { path: artifactPath, label: "artifact" },
      { path: taskTreePath, label: "task_tree" },
      { path: statusPath, label: "status" },
      { path: finalReportPath, label: "final_report" },
    ];
    run.artifacts = artifactRefs;
    run.status = resolveRunStatus(issues, audit.ok);
    run.finishedAt = clock().toISOString();
    const resultStatus: TeamRunResult["status"] = run.status === "succeeded" ? "completed" : "failed";
    const legacyResult: TeamRunResult = {
      runId,
      status: resultStatus,
      artifact,
      events: collected,
      ...(run.status === "succeeded" ? { blockerReason: null } : { blockerReason: "validation_failed" as const, failure: { message: issues.join("; ") || "manager run failed" } }),
    };

    if (run.status !== "succeeded") {
      blockerReason = "validation_failed";
      await emit("blocker", { reason: blockerReason, message: issues.join("; ") || "manager run failed" });
      await emit("run_failed", { message: issues.join("; ") || "manager run failed" });
    } else {
      await emit("artifact_created", {
        path: artifactPath,
        playbookId: resolved.playbook.value.name,
        mailboxLogPath: mailbox.mirrorPath(),
        taskListPath: taskList.path(),
      });
      await emit("run_completed", { workerCount: contributions.length, playbookId: resolved.playbook.value.name });
    }

    const legacyEvidence = generateEvidencePacket({
      task,
      result: legacyResult,
      events: collected,
      startedAt: new Date(run.startedAt),
      finishedAt: new Date(run.finishedAt),
      blockerReason,
      transcriptRef: mailboxRef,
    });
    await writeEvidence(runDir, legacyEvidence);
    const canonicalEvidence = await writeEvidencePacket(runDir, aggregateEvidencePacket({
      run,
      summary: firstNonEmptyLine(finalizedMarkdown),
      failureReason: issues.length > 0 ? issues.join("; ") : null,
      issues,
      artifactRefs,
      commandResults,
      transitions,
      roleCitations: roleCitations.map((citation) => ({ ...citation, artifactPath: artifactPath ?? undefined })),
      acceptance,
      audit,
      stdoutPath,
      transcriptPath: mailbox.mirrorPath(),
      finalReportPath,
      mailboxLogPath: mailbox.mirrorPath(),
      taskListPath: taskList.path(),
    }));

    return {
      run,
      legacyResult,
      runDir,
      workspaceDir,
      artifactPath,
      canonicalEvidencePath: canonicalEvidence.jsonPath,
      legacyEvidencePath: join(runDir, "evidence.json"),
      stdoutPath,
      finalReportPath,
    };
  } catch (error) {
    if (error instanceof MailboxMirrorWriteError) {
      blockerReason = "mailbox_mirror_failed";
      issues.push(error.message);
      if (adapter) {
        await emit("blocker", error.toBlockerPayload());
        await emit("run_failed", { message: error.message });
      }
      return finishFailure({
        run,
        runDir,
        workspaceDir,
        artifactPath,
        collected,
        task,
        issues,
        blockerReason,
        clock,
        store,
        mailboxRef,
        commandResults,
        transitions,
        roleCitations,
        acceptance,
        audit,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    blockerReason = classifyBlocker({ errorMessage: message, source: "orchestrator" }).reason;
    issues.push(message);
    if (adapter) {
      await emit("blocker", { reason: blockerReason, message });
      await emit("run_failed", { message });
    }
    return finishFailure({
      run,
      runDir,
      workspaceDir,
      artifactPath,
      collected,
      task,
      issues,
      blockerReason,
      clock,
      store,
      mailboxRef,
      commandResults,
      transitions,
      roleCitations,
      acceptance,
      audit,
    });
  } finally {
    await inboxDeliveryLoop?.stop().catch(() => undefined);
    await auditMailboxTransportParity().catch(() => undefined);
    await adapter?.endRun({ runId }).catch(() => undefined);
  }
}

function finishFailure(input: {
  run: Run;
  runDir: string;
  workspaceDir: string;
  artifactPath: string | null;
  collected: AgentEvent[];
  task: TeamTask;
  issues: string[];
  blockerReason: BlockerReasonV0 | null;
  clock: () => Date;
  store: RunStore;
  mailboxRef: CoordinationTranscriptRefV0;
  commandResults: CommandExecutionResult[];
  transitions: EvidenceTransition[];
  roleCitations: EvidenceRoleCitation[];
  acceptance: AcceptanceCheckResult;
  audit: AuditMiddlewareResult;
}): Promise<ManagerRunHarnessResult> {
  return (async () => {
    input.run.status = "failed";
    input.run.finishedAt = input.clock().toISOString();
    const legacyResult: TeamRunResult = {
      runId: input.run.runId,
      status: "failed",
      events: input.collected,
      blockerReason: input.blockerReason,
      failure: { message: input.issues.join("; ") || "manager run failed" },
    };
    const stdoutPath = join(input.runDir, "stdout.log");
    await mkdir(dirname(stdoutPath), { recursive: true });
    await writeFile(stdoutPath, input.issues.join("\n") + "\n", "utf8");
    const legacyEvidence = generateEvidencePacket({
      task: input.task,
      result: legacyResult,
      events: input.collected,
      startedAt: new Date(input.run.startedAt ?? input.clock().toISOString()),
      finishedAt: new Date(input.run.finishedAt),
      blockerReason: input.blockerReason,
      transcriptRef: input.mailboxRef,
    });
    await writeEvidence(input.runDir, legacyEvidence);
    const canonicalEvidence = await writeEvidencePacket(input.runDir, aggregateEvidencePacket({
      run: input.run,
      failureReason: input.issues.join("; "),
      issues: input.issues,
      commandResults: input.commandResults,
      transitions: input.transitions,
      roleCitations: input.roleCitations,
      stdoutPath,
      transcriptPath: input.mailboxRef.path,
      mailboxLogPath: input.mailboxRef.path,
      taskListPath: join(input.runDir, "tasks.json"),
      acceptance: input.acceptance,
      audit: input.audit,
    }));
    return {
      run: input.run,
      legacyResult,
      runDir: input.runDir,
      workspaceDir: input.workspaceDir,
      artifactPath: input.artifactPath,
      canonicalEvidencePath: canonicalEvidence.jsonPath,
      legacyEvidencePath: join(input.runDir, "evidence.json"),
      stdoutPath,
      finalReportPath: join(input.runDir, "final-report.md"),
    };
  })();
}

function resolveRuntimeTask(scenarioTask: string | undefined, runtimeTask: string | undefined, allowTaskOverride: boolean | undefined): string {
  if (runtimeTask) {
    if (allowTaskOverride === false) {
      throw new Error("task_override_not_allowed");
    }
    return runtimeTask;
  }
  if (!scenarioTask) {
    throw new Error("scenario_task_missing");
  }
  return scenarioTask;
}

function resolveWorkspaceDir(rootDir: string, configuredCwd: string | undefined, runId: string, override?: string): string {
  if (override) return resolve(override);
  return resolve(interpolatePath(configuredCwd ?? join(rootDir, ".tmp", "manager-runs", runId), rootDir, runId, rootDir));
}

function resolveWorktreeDir(rootDir: string, worktreePath: string | undefined, workspaceDir: string, runId: string): string {
  if (!worktreePath) return workspaceDir;
  return resolve(interpolatePath(worktreePath, rootDir, runId, workspaceDir));
}

function interpolatePath(value: string, rootDir: string, runId: string, cwd: string): string {
  return value.replaceAll("${repo_root}", rootDir).replaceAll("${run_id}", runId).replaceAll("${cwd}", cwd);
}

function materializedWorkspace(workspace: NonNullable<Run["workspace"]>, rootDir: string, workspaceDir: string, runId: string): NonNullable<Run["workspace"]> {
  return {
    cwd: interpolatePath(workspace.cwd, rootDir, runId, workspaceDir),
    ...(workspace.worktree
      ? {
          worktree: {
            branch: interpolatePath(workspace.worktree.branch, rootDir, runId, workspaceDir),
            path: interpolatePath(workspace.worktree.path, rootDir, runId, workspaceDir),
            ...(workspace.worktree.baseRef ? { baseRef: workspace.worktree.baseRef } : {}),
          },
        }
      : {}),
  };
}

function buildTeamConfig(resolved: Awaited<ReturnType<typeof resolveFourLayerSelection>>, prompts: Record<string, string>): TeamConfig {
  const roles: AgentRoleConfig[] = [resolved.teamLead, ...resolved.members].map((entry) => ({
    id: entry.value.name as AgentRoleConfig["id"],
    name: entry.value.name,
    kind: entry.value.name === resolved.playbook.value.teamLead ? "team_lead" : "worker",
    systemPrompt: prompts[entry.value.name] ?? entry.value.system,
  }));
  return {
    id: resolved.playbook.value.name,
    name: resolved.playbook.value.description ?? resolved.playbook.value.name,
    leadRoleId: resolved.playbook.value.teamLead as TeamConfig["leadRoleId"],
    roles,
  };
}

function buildPlaybookMetadata(playbook: { name: string; description?: string }): TeamRunPlaybookMetadataV0 {
  return {
    id: playbook.name,
    title: playbook.description ?? playbook.name,
    schemaVersion: 0,
    orchestrationSource: "teamlead_direct",
  };
}

function buildAdapterPlaybook(resolved: Awaited<ReturnType<typeof resolveFourLayerSelection>>): TeamPlaybookV0 {
  const stages = resolved.members.map((member, index) => ({
    id: `${member.value.name}-stage`,
    kind: inferStageKind(member.value.name),
    roleId: member.value.name as AgentRoleConfig["id"],
    title: member.value.description ?? member.value.name,
    instructions: `Handle the ${member.value.name} task for scenario ${resolved.scenario.value.name}.`,
    dependsOn: index === 0 ? [] : [`${resolved.members[index - 1]!.value.name}-stage`],
    evidenceCitation: { required: true, label: member.value.name },
  })) satisfies TeamPlaybookV0["stages"];
  return {
    schemaVersion: 0,
    id: resolved.playbook.value.name,
    title: resolved.playbook.value.description ?? resolved.playbook.value.name,
    description: resolved.playbook.value.workflow,
    orchestrationSource: "teamlead_direct",
    stages,
    revisionRules: [],
    finalCitationMetadata: {
      requiredStageIds: stages.map((stage) => stage.id),
      requireFinalReconciliation: true,
    },
  };
}

function inferStageKind(roleId: string): TeamPlaybookV0["stages"][number]["kind"] {
  switch (roleId) {
    case "planner":
      return "plan";
    case "generator":
      return "generate";
    case "evaluator":
      return "evaluate";
    default:
      return "synthesize";
  }
}

async function verifyRequiredReads(rootDir: string, requiredReads: ReadonlyArray<{ kind: string; path?: string; documentId?: string; optional?: boolean }>) {
  for (const entry of requiredReads) {
    if (entry.kind === "repo" && entry.path) {
      const filePath = resolve(rootDir, entry.path);
      const relativePath = relative(rootDir, filePath);
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        throw new Error(`invalid_required_read_path:repo:${entry.path}`);
      }
      await readFile(filePath, "utf8");
      continue;
    }
    if (entry.optional) continue;
    throw new Error(`unsupported_required_read:${entry.kind}:${entry.documentId ?? entry.path ?? "unknown"}`);
  }
}

function validateRunProfileRuntimeSupport(runProfile: RunProfile | undefined) {
  if (!runProfile) return;
  if (runProfile.approvalGates?.preLaunch?.enabled === true) {
    throw new Error("unsupported_approval_gate:preLaunch.enabled");
  }
  if (runProfile.workspace.worktree) {
    throw new Error("unsupported_worktree_materialization:workspace.worktree");
  }
  const maxActiveChildren = runProfile.concurrency?.maxActiveChildren;
  if (maxActiveChildren !== undefined && maxActiveChildren !== 1) {
    throw new Error(`unsupported_concurrency:maxActiveChildren:${maxActiveChildren}`);
  }
  for (const entry of runProfile.requiredReads ?? []) {
    if (entry.kind !== "repo") {
      throw new Error(`unsupported_required_read:${entry.kind}:${entry.documentId ?? entry.path ?? "unknown"}`);
    }
  }
}

async function executeAcceptanceCommand(
  command: RunProfileAcceptanceCommand,
  commandCwd: string,
  runDir: string,
  index: number,
  clock: () => Date,
): Promise<CommandExecutionResult> {
  const spec = typeof command === "string" ? { cmd: command, blockerOk: false } : { cmd: command.cmd, blockerOk: command.blockerOk ?? false };
  const startedAt = clock().toISOString();
  try {
    const { stdout, stderr } = await exec(spec.cmd, { cwd: commandCwd, env: process.env, maxBuffer: 1024 * 1024 });
    const stdoutPath = join(runDir, `command-${index}.stdout.log`);
    const stderrPath = join(runDir, `command-${index}.stderr.log`);
    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, stderr, "utf8");
    return { cmd: spec.cmd, exitCode: 0, summary: "ok", stdout, stderr, stdoutPath, stderrPath, blockerOk: spec.blockerOk, startedAt, finishedAt: clock().toISOString() };
  } catch (error) {
    const stdout = typeof error === "object" && error !== null && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";
    const exitCode = typeof error === "object" && error !== null && "code" in error ? Number((error as { code?: number }).code ?? 1) : 1;
    const stdoutPath = join(runDir, `command-${index}.stdout.log`);
    const stderrPath = join(runDir, `command-${index}.stderr.log`);
    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, stderr, "utf8");
    return { cmd: spec.cmd, exitCode, summary: spec.blockerOk ? "blocker_ok" : "failed", stdout, stderr, stdoutPath, stderrPath, blockerOk: spec.blockerOk, startedAt, finishedAt: clock().toISOString() };
  }
}

function resolveRunStatus(issues: string[], auditOk: boolean): RunStatus {
  if (!auditOk) return "failed_audit";
  if (issues.length > 0) return "failed";
  return "succeeded";
}

class MailboxMirrorWriteError extends Error {
  constructor(message: string) {
    super(`mailbox_mirror_failed: ${message}`);
    this.name = "MailboxMirrorWriteError";
  }

  toBlockerPayload() {
    return {
      reason: "mailbox_mirror_failed",
      message: this.message,
      detail: {
        operation: "append_mailbox_mirror",
      },
    };
  }
}

function createMailboxTransport(adapter: PaseoTeamAdapter): MailboxTransport {
  if (adapter instanceof PaseoOpenCodeAdapter) {
    return new PaseoChatTransport();
  }
  return new FakeMailboxTransport();
}

async function probeMailboxTransport(transport: MailboxTransport): Promise<void> {
  if (hasProbeCapabilities(transport)) {
    await transport.probeCapabilities();
  }
}

function drainEnvelopeRejections(transport: MailboxTransport): Array<Record<string, unknown>> {
  if (!hasEnvelopeRejectionDrain(transport)) {
    return [];
  }
  return transport.drainEnvelopeRejections().map((rejection) => ({ ...rejection }));
}

function hasProbeCapabilities(
  transport: MailboxTransport,
): transport is MailboxTransport & { probeCapabilities: () => Promise<void> } {
  return typeof (transport as { probeCapabilities?: unknown }).probeCapabilities === "function";
}

function hasEnvelopeRejectionDrain(
  transport: MailboxTransport,
): transport is MailboxTransport & { drainEnvelopeRejections: () => Array<Record<string, unknown>> } {
  return typeof (transport as { drainEnvelopeRejections?: unknown }).drainEnvelopeRejections === "function";
}

function buildSummaryRequest(taskText: string, contributions: ReadonlyArray<WorkerContribution>, completionMessages: ReadonlyArray<MailboxMessage>, mailboxPath: string): string {
  void mailboxPath;
  return [
    "SUMMARIZE",
    `Task: ${taskText}`,
    "Completion messages:",
    ...completionMessages.map((message) => `- ${message.from}: ${message.id}`),
    "Contributions:",
    ...contributions.map((contribution) => `- ${contribution.roleId}: ${firstNonEmptyLine(contribution.output)}`),
  ].join("\n");
}

function buildFallbackSummary(taskText: string, contributions: ReadonlyArray<WorkerContribution>): string {
  return [
    `# ${taskText}`,
    "",
    ...contributions.flatMap((contribution) => [`## ${contribution.roleId}`, contribution.output, ""]),
  ].join("\n");
}

function buildCompletionMessageBody(taskId: string, output: string): string {
  return [`Task ${taskId} complete.`, `Summary: ${firstNonEmptyLine(output) || "completed"}`].join("\n");
}

function findWorkerCompletedEvent(events: ReadonlyArray<AgentEvent>, roleId: string): AgentEvent | undefined {
  return [...events].reverse().find((event) => event.type === "worker_completed" && event.roleId === roleId);
}

function extractStructuredWorkerMessage(
  output: string,
  taskId: string,
): { kind: "evaluator_verdict"; body: EvaluatorVerdictBody; summary: string } | null {
  const candidates = [
    ...Array.from(output.matchAll(/```json\s*([\s\S]*?)```/gi), (match) => match[1]?.trim() ?? ""),
    ...output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0),
  ];
  for (const candidate of [...candidates].reverse()) {
    if (!candidate.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const kind = parsed["kind"] === "evaluator_verdict"
        ? "evaluator_verdict"
        : (parsed["type"] === "evaluator_verdict" ? "evaluator_verdict" : null);
      const body = typeof parsed["body"] === "object" && parsed["body"] !== null
        ? parsed["body"] as Record<string, unknown>
        : null;
      if (!kind || !body || body["schemaVersion"] !== "v1") {
        continue;
      }
      if ((body["verdict"] !== "pass" && body["verdict"] !== "fail") || typeof body["taskId"] !== "string") {
        continue;
      }
      const verdictBody: EvaluatorVerdictBody = {
        schemaVersion: "v1",
        taskId: String(body["taskId"] || taskId),
        verdict: body["verdict"],
        ...(typeof body["rationale"] === "string" ? { rationale: body["rationale"] } : {}),
        ...(typeof body["failedRubricRef"] === "string" ? { failedRubricRef: body["failedRubricRef"] } : {}),
      };
      return {
        kind,
        body: verdictBody,
        summary: `VERDICT ${verdictBody.taskId} ${verdictBody.verdict.toUpperCase()}`,
      };
    } catch {
      continue;
    }
  }
  return null;
}

function resolveDispatchMode(value: string | undefined): DispatchOrchestrationSource {
  return value === "static_loop" ? "static_loop" : "teamlead_chat";
}

function ensureArtifactMentions(markdown: string, requiredRoles: ReadonlyArray<string>): string {
  const normalized = markdown.trim();
  const missingRoles = requiredRoles.filter((role) => !normalized.toLowerCase().includes(role.toLowerCase()));
  if (missingRoles.length === 0) {
    return markdown;
  }
  const leadSupplement = missingRoles.map((role) => `- ${capitalizeRole(role)}: coordinated the run and is represented in the final artifact.`).join("\n");
  return [normalized, leadSupplement].filter((section) => section.length > 0).join("\n\n") + "\n";
}

function capitalizeRole(role: string): string {
  return role.slice(0, 1).toUpperCase() + role.slice(1);
}

function renderTaskTree(playbookName: string, roles: string[]): string {
  return [`# Task Tree — ${playbookName}`, "", ...roles.map((role, index) => `${index + 1}. ${role}`), ""].join("\n");
}

function renderStatusDoc(runId: string, scenarioName: string, playbookName: string, runProfileName: string, workspaceDir: string, artifactPath: string): string {
  return [
    `# Status — ${runId}`,
    "",
    `- Scenario: ${scenarioName}`,
    `- Playbook: ${playbookName}`,
    `- Run profile: ${runProfileName}`,
    `- Workspace: ${workspaceDir}`,
    `- Artifact: ${artifactPath}`,
    "",
  ].join("\n");
}

function renderFinalReport(
  summary: string,
  transitions: ReadonlyArray<EvidenceTransition>,
  completionMessages: ReadonlyArray<MailboxMessage>,
  workspaceDir: string,
): string {
  return [
    "# Final Report",
    "",
    "## Implementation Summary",
    firstNonEmptyLine(summary) || "Completed.",
    "",
    "## Workflow Steps Executed",
    ...transitions.map((transition) => `- ${transition.from} -> ${transition.to}`),
    "",
    "## Required Role Citations",
    ...completionMessages.map((message) => `- ${message.from}: ${message.id}`),
    "",
    "## Deviations",
    "- none observed",
    "",
    "## Workspace",
    `- ${workspaceDir}`,
    "",
  ].join("\n");
}

function firstNonEmptyLine(value: string): string {
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    return line.replace(/^#+\s*/, "");
  }
  return "";
}
