import { randomUUID } from "node:crypto";
import { exec as execCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type { PaseoTeamAdapter } from "../contracts/adapter.js";
import { FakeMailboxTransport } from "../adapters/fake/fake-mailbox-transport.js";
import { PaseoChatTransport, PaseoChatUnavailableError } from "../adapters/paseo-opencode/paseo-chat-transport.js";
import { PaseoOpenCodeAdapter } from "../adapters/paseo-opencode/paseo-opencode-adapter.js";
import {
  type CommandExecutionResult,
  finishManagerHarnessFailure,
  type ManagerRunHarnessResult,
} from "./harness/failure.js";
import {
  buildPlaybookMetadata,
  materializeRunWorkspace,
  validateRunProfileRuntimeSupport,
  verifyRequiredReads,
} from "./harness/preflight.js";
import {
  buildFallbackSummary,
  buildSummaryRequest,
  ensureArtifactMentions,
  ensureCompletionMessageCitations,
  firstNonEmptyLine,
  renderFinalReport,
  renderStatusDoc,
  renderTaskTree,
  selectFinalArtifactMarkdown,
} from "./harness/reporting.js";
import {
  bestEffortCleanup,
  buildCompletionMessageBody,
  executeAcceptanceCommand,
  extractStructuredWorkerMessage,
  findWorkerCompletedEvent,
  readWorkspaceArtifact,
  resolveDispatchMode,
  resolveRunStatus,
} from "./harness/utilities.js";
import type {
  AgentEvent,
  AgentEventType,
  AgentRoleConfig,
  BlockerReasonV0,
  CoordinationTranscriptRefV0,
  FinalArtifact,
  TeamConfig,
  TeamRunResult,
  TeamTask,
  WorkerContribution,
} from "../contracts/types.js";
import type {
  DispatchOrchestrationSource,
  EvaluatorVerdictBody,
  EvidenceAuditEvent,
  EvidenceAuditEventKind,
  EvidenceAuditHookBoundary,
  FinalReconciliationBody,
  MailboxEnvelope,
  EvidenceRoleCitation,
  EvidenceTransition,
  MailboxMessage,
  MailboxMessageKind,
  Run,
  RunArtifactRef,
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
  compileRunPackage,
  runAcceptanceChecks,
  runAuditMiddleware,
  runHooks,
  writeEvidencePacket,
} from "../four-layer/index.js";
import { captureRuntimeOwnedFileSnapshot } from "../four-layer/runtime-owned-files.js";
import {
  materializeRuntimeHelperWorkspace,
  resolveRuntimeHelperMvpEnabled,
  startRuntimeHelperServer,
} from "./runtime-helper.js";

const exec = promisify(execCallback);
const DEFAULT_LEAD_TIMEOUT_SECONDS = 600;
const CLEANUP_TIMEOUT_MS = 5_000;

export type { ManagerRunHarnessResult } from "./harness/failure.js";

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
  workspaceSubdirPerRun?: boolean;
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
  runtimeHelperMvp?: boolean;
  idGen?: () => string;
  clock?: () => Date;
  onPhase?: (phase: string, details: Record<string, unknown>) => Promise<void> | void;
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
  const runId = idGen();
  const dispatchMode = resolveDispatchMode(process.env["PLUTO_DISPATCH_MODE"]);
  const runtimeHelperMvp = resolveRuntimeHelperMvpEnabled(options.runtimeHelperMvp);
  const workspaceSubdirPerRun = runtimeHelperMvp ? true : (options.workspaceSubdirPerRun ?? false);
  const compiled = await compileRunPackage({
    rootDir,
    selection: options.selection,
    runId,
    workspaceOverride: options.workspaceOverride,
    workspaceSubdirPerRun,
    dispatchMode,
    runtimeHelperMvp,
  });
  const resolved = compiled.resolved;
  const runPackage = compiled.package;
  const runProfile = resolved.runProfile?.value;
  const autoDriveDispatch = runtimeHelperMvp ? false : (options.autoDriveDispatch ?? true);
  const taskText = runPackage.task;
  const team = runPackage.team;
  const workspaceDir = runPackage.workspace.materializedCwd;
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
    workspace: runProfile ? materializeRunWorkspace(runProfile.workspace, rootDir, workspaceDir, runId) : { cwd: workspaceDir },
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
  const auditEvents: EvidenceAuditEvent[] = [];
  const stdoutLines: string[] = [];
  const issues: string[] = [];
  let artifactPath: string | null = null;
  let acceptance: AcceptanceCheckResult = { ok: true, issues: [] };
  let audit: AuditMiddlewareResult = { ok: true, status: "succeeded", issues: [] };
  let blockerReason: BlockerReasonV0 | null = null;
  let adapter: PaseoTeamAdapter | undefined;
  let mailboxTransport: MailboxTransport | undefined;
  let inboxDeliveryLoop: InboxDeliveryLoopHandle | undefined;
  let runtimeHelperServer: ReturnType<typeof startRuntimeHelperServer> | undefined;
  const playbookMetadata = buildPlaybookMetadata(resolved.playbook.value);
  const adapterPlaybook = runPackage.adapterPlaybook;
  const roleSessionIds = new Map<string, string>();
  const respondedPlanApprovalRequests = new Set<string>();
  const semanticallyHandledLeadMessages = new Map<string, {
    deliveryMode: "runtime_helper_semantic" | "runtime_helper_wait";
    semanticHandling: string;
  }>();
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
    extraPayload?: Record<string, unknown>,
  ) => {
    await emit("mailbox_message", {
      messageId: message.id,
      to: message.to,
      from: message.from,
      kind: message.kind,
      transportMessageId: message.transportMessageId,
      ...(orchestrationSource ? { orchestrationSource } : {}),
      ...(extraPayload ?? {}),
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

  const recordAuditEvent = async (
    kind: EvidenceAuditEventKind,
    payload: Omit<EvidenceAuditEvent, "kind">,
  ): Promise<void> => {
    auditEvents.push({ kind, ...payload });
    await emit(kind, payload);
  };

  const checkRuntimeMirror = async (
    kind: EvidenceAuditEventKind,
    hookBoundary: EvidenceAuditHookBoundary,
    filePath: string,
    readSnapshot: () => Promise<{ sha256: string; lineCount: number } | null>,
  ): Promise<void> => {
    const lastKnown = await readSnapshot();
    if (!lastKnown) return;
    // Best-effort capture: if the observed snapshot fails to read, audit guard
    // stays emit-only and the boundary is skipped without aborting the run.
    let observed;
    try {
      observed = await captureRuntimeOwnedFileSnapshot(filePath, clock().toISOString());
    } catch {
      return;
    }
    if (observed.sha256 === lastKnown.sha256 && observed.lineCount === lastKnown.lineCount) {
      return;
    }
    await recordAuditEvent(kind, {
      filePath,
      lastKnownSha256: lastKnown.sha256,
      observedSha256: observed.sha256,
      lastKnownLineCount: lastKnown.lineCount,
      observedLineCount: observed.lineCount,
      hookBoundary,
    });
  };

  const auditRuntimeMirrors = async (hookBoundary: EvidenceAuditHookBoundary): Promise<void> => {
    await options.onPhase?.("before_hook_boundary", {
      runId,
      runDir,
      hookBoundary,
      mailboxPath: mailbox.mirrorPath(),
      taskListPath: taskList.path(),
    });
    await Promise.all([
      checkRuntimeMirror(
        "mailbox_external_write_detected",
        hookBoundary,
        mailbox.mirrorPath(),
        () => mailbox.readRuntimeSnapshot(),
      ),
      checkRuntimeMirror(
        "tasklist_external_write_detected",
        hookBoundary,
        taskList.path(),
        () => taskList.readRuntimeSnapshot(),
      ),
    ]);
  };

  try {
    validateRunProfileRuntimeSupport(runProfile);
    await verifyRequiredReads(rootDir, runProfile?.requiredReads ?? []);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    blockerReason = classifyBlocker({ errorMessage: message, source: "orchestrator" }).reason;
    return finishManagerHarnessFailure({
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
      auditEvents,
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
    const runtimeHelper = await materializeRuntimeHelperWorkspace({
      enabled: runtimeHelperMvp,
      workspaceDir,
      runDir,
      runId,
      leadRoleId: team.leadRoleId,
      roleIds: team.roles.map((role) => role.id),
      taskListPath: taskList.path(),
    });
    await writeFile(join(runDir, "workspace-materialization.json"), JSON.stringify({
      runId,
      repoRoot: rootDir,
      workspaceDir,
      runProfile: resolved.runProfile?.value.name ?? null,
      mailboxPath: mailbox.mirrorPath(),
      taskListPath: taskList.path(),
      runtimeHelper: runtimeHelper.enabled
        ? {
            rootDir: runtimeHelper.rootDir,
            requestsPath: runtimeHelper.requestsPath,
            usageLogPath: runtimeHelper.usageLogPath,
          }
        : null,
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
        return finishManagerHarnessFailure({
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
          auditEvents,
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
      runtimeHelperEnabled: runtimeHelperMvp,
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
    const completionMessageIds = new Set<string>();
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
    const rememberCompletionMessage = (message: MailboxMessage) => {
      if (completionMessageIds.has(message.id)) {
        return;
      }
      completionMessageIds.add(message.id);
      completionMessages.push(message);
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
      rememberCompletionMessage(completionMessage);
      await recordMailboxMessageEvent(completionMessage, entry.role.id, sessionId, dispatchMode);
    };

    const processedLeadMailboxMessageIds = new Set<string>();
    const resolveRuntimeHelperWaitForRole = async (roleId: string): Promise<boolean> => {
      if (!runtimeHelperServer?.hasPendingWait(roleId)) {
        return false;
      }
      return await runtimeHelperServer.resolvePendingWaitsForRole(roleId);
    };
    const settleLeadSemanticDelivery = async (message: MailboxMessage): Promise<{
      deliveryMode: "runtime_helper_semantic" | "runtime_helper_wait";
      semanticHandling: string;
    } | null> => {
      if (message.kind === "plan_approval_request") {
        await autoRespondToPlanApproval(message);
        return {
          deliveryMode: await resolveRuntimeHelperWaitForRole(leadRole.id) ? "runtime_helper_wait" : "runtime_helper_semantic",
          semanticHandling: "plan_approval_auto_response",
        };
      }

      if (message.from === "pluto" && message.summary === "RUN_START") {
        return {
          deliveryMode: await resolveRuntimeHelperWaitForRole(leadRole.id) ? "runtime_helper_wait" : "runtime_helper_semantic",
          semanticHandling: "run_start_notice",
        };
      }

      if (!(await handleLeadMailboxMessage(message))) {
        return null;
      }

      return {
        deliveryMode: await resolveRuntimeHelperWaitForRole(leadRole.id) ? "runtime_helper_wait" : "runtime_helper_semantic",
        semanticHandling: `lead_${message.kind}`,
      };
    };
    const handleLeadMailboxMessage = async (message: MailboxMessage): Promise<boolean> => {
      if (dispatchMode !== "teamlead_chat") {
        return false;
      }

      switch (message.kind) {
        case "evaluator_verdict": {
          if (processedLeadMailboxMessageIds.has(message.id)) {
            return true;
          }
          processedLeadMailboxMessageIds.add(message.id);
          if (!isEvaluatorVerdict(message)) {
            return true;
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
            return true;
          }
          if (message.body.failedRubricRef && !validRubricRefs.has(message.body.failedRubricRef)) {
            return true;
          }
          evaluatorVerdictsByMessageId.set(message.id, message.body);
          await emit("evaluator_verdict_received", {
            taskId: message.body.taskId,
            verdict: message.body.verdict,
            ...(message.body.failedRubricRef ? { failedRubricRef: message.body.failedRubricRef } : {}),
            orchestrationSource: dispatchMode,
          }, message.from as AgentEvent["roleId"], sessionId);
          return true;
        }
        case "spawn_request": {
          if (processedLeadMailboxMessageIds.has(message.id)) {
            return true;
          }
          processedLeadMailboxMessageIds.add(message.id);
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
            return true;
          }
          if (!isSpawnRequest(message)) {
            await emit("spawn_request_rejected", {
              messageId: message.id,
              reason: "invalid_body",
              orchestrationSource: dispatchMode,
            }, leadRole.id, leadSession.sessionId);
            return true;
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
            return true;
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
            return true;
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
            return true;
          }

          await emit("task_claimed", {
            taskId: claimedTask.id,
            claimedBy: entry.role.id,
            orchestrationSource: dispatchMode,
          }, entry.role.id);

          const idleHook = createIdleNudgeHook({ roleId: entry.role.id, taskList });
          await runHooks([idleHook], { roleId: entry.role.id });
          await auditRuntimeMirrors("teammate_idle");
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
          if (!runtimeHelperMvp) {
            await postWorkerCompleteMessage(entry, output, completedEvent?.sessionId ?? workerSession.sessionId);
          }
          return true;
        }
        case "worker_complete": {
          if (processedLeadMailboxMessageIds.has(message.id)) {
            return true;
          }
          processedLeadMailboxMessageIds.add(message.id);
          if (!isWorkerComplete(message)) {
            return true;
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
            return true;
          }
          rememberCompletionMessage(message);
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
            return true;
          }
          const nextEntry = dispatchPlan.find((entry) =>
            !completedDispatchTaskIds.has(entry.task.id)
            && entry.task.dependsOn.every((dependencyId) => completedDispatchTaskIds.has(dependencyId)),
          );
          if (nextEntry) {
            await postSpawnRequestMessage(nextEntry, `Continue after ${message.body.taskId}.`);
            return true;
          }
          if (dispatchPlan.length > 0 && completedDispatchTaskIds.size === dispatchPlan.length) {
            await postFinalReconciliationMessage();
          }
          return true;
        }
        case "final_reconciliation": {
          if (processedLeadMailboxMessageIds.has(message.id)) {
            return true;
          }
          processedLeadMailboxMessageIds.add(message.id);
          if (!isFinalReconciliation(message)) {
            return true;
          }
          if (message.from !== leadRole.id) {
            await emit("final_reconciliation_invalid", {
              messageId: message.id,
              fromRole: message.from,
              reason: "untrusted_sender",
              orchestrationSource: dispatchMode,
            }, leadRole.id, leadSession.sessionId);
            return true;
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
          return true;
        }
        default:
          return false;
      }
    };

    if (runtimeHelper.enabled) {
      runtimeHelperServer = startRuntimeHelperServer({
        taskListPath: taskList.path(),
        requestsPath: runtimeHelper.requestsPath,
        responsesDir: runtimeHelper.responsesDir,
        clock,
        roleSessionId: (roleId) => roleSessionIds.get(roleId),
        sendMessage: sendMailboxMessage,
        recordMailboxMessage: async (message, roleId, sessionId, extraPayload) => {
          await recordMailboxMessageEvent(message, roleId, sessionId, resolveMailboxOrchestrationSource(message), extraPayload);
          if (runtimeHelperMvp && message.to === leadRole.id) {
            const handled = await settleLeadSemanticDelivery(message);
            if (handled) {
              semanticallyHandledLeadMessages.set(message.id, handled);
            }
          }
        },
      });
    }

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
        const currentTask = await taskList.read(taskId);
        if (currentTask?.status === "completed") {
          respondedPlanApprovalRequests.add(message.id);
          return;
        }
      }
      respondedPlanApprovalRequests.add(message.id);
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
      interceptDelivery: async ({ message, roleId }) => {
        if (roleId === leadRole.id) {
          const preHandled = semanticallyHandledLeadMessages.get(message.id);
          if (preHandled) {
            return preHandled;
          }
        }

        if (!runtimeHelperMvp || roleId !== leadRole.id) {
          return false;
        }

        const handled = await settleLeadSemanticDelivery(message);
        if (handled) {
          return handled;
        }

        return false;
      },
      onDelivered: async ({ message, roleId }) => {
        try {
          if (message.kind === "plan_approval_request" && roleId === leadRole.id) {
            await autoRespondToPlanApproval(message);
            return;
          }

          if (dispatchMode !== "teamlead_chat" || roleId !== leadRole.id) {
            return;
          }

          if (await handleLeadMailboxMessage(message)) {
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
              await auditRuntimeMirrors("teammate_idle");
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
              if (!runtimeHelperMvp) {
                await postWorkerCompleteMessage(entry, output, completedEvent?.sessionId ?? workerSession.sessionId);
              }
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
              rememberCompletionMessage(message);
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
        await auditRuntimeMirrors("teammate_idle");
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
        rememberCompletionMessage(completionMessage);
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
      message: buildSummaryRequest(taskText, contributions, completionMessages, mailboxRef.roomRef),
    });
    const summaryEvents = await persistAdapterEvents();
    const leadSummaryEvent = [...summaryEvents].reverse().find((event) => event.type === "lead_message");
    const markdown = leadSummaryEvent
      ? String(leadSummaryEvent.transient?.rawPayload?.markdown ?? leadSummaryEvent.payload.markdown ?? "")
      : buildFallbackSummary(taskText, contributions);
    const workspaceArtifactMarkdown = await readWorkspaceArtifact(join(workspaceDir, "artifact.md"));
    const finalizedMarkdown = ensureArtifactMentions(
      ensureCompletionMessageCitations(
        selectFinalArtifactMarkdown(markdown, workspaceArtifactMarkdown, completionMessages),
        completionMessages,
      ),
      [leadRole.id, ...memberRoles.map((role) => role.id)],
    );
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
      leadSummary: firstNonEmptyLine(markdown),
      contributions,
    };
    artifactPath = await store.writeArtifact(artifact);
    await writeFile(join(workspaceDir, "artifact.md"), finalizedMarkdown, "utf8");

    if (lastTask) {
      const hookResult = await runHooks([acceptanceHook], { task: lastTask });
      issues.push(...hookResult.messages);
      await auditRuntimeMirrors("task_completed");
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

    await auditRuntimeMirrors("run_end");

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
      auditEvents,
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
      return finishManagerHarnessFailure({
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
        auditEvents,
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
    return finishManagerHarnessFailure({
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
      auditEvents,
      acceptance,
      audit,
    });
  } finally {
    await bestEffortCleanup(() => runtimeHelperServer?.stop(), CLEANUP_TIMEOUT_MS);
    await bestEffortCleanup(() => inboxDeliveryLoop?.stop(), CLEANUP_TIMEOUT_MS);
    await bestEffortCleanup(() => auditMailboxTransportParity(), CLEANUP_TIMEOUT_MS);
    await bestEffortCleanup(() => adapter?.endRun({ runId }), CLEANUP_TIMEOUT_MS);
  }
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
