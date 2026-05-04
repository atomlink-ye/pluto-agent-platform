import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

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
  readWorkspaceArtifact,
  resolveDispatchMode,
  resolveRunStatus,
} from "./harness/utilities.js";
import { executeDispatchEntry, type DispatchPlanEntry } from "./harness/dispatch-executor.js";
import { createMailboxRuntime, MailboxMirrorWriteError } from "./harness/mailbox-runtime.js";
import { createLeadControlPlane } from "./harness/control-plane.js";
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
  EvidenceAuditEvent,
  EvidenceRoleCitation,
  EvidenceTransition,
  MailboxMessage,
  MailboxMessageKind,
  Run,
  RunArtifactRef,
  TaskRecord,
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
  FileBackedMailbox,
  FileBackedTaskList,
  compileRunPackage,
  runAcceptanceChecks,
  runAuditMiddleware,
  runHooks,
  writeEvidencePacket,
} from "../four-layer/index.js";
import {
  materializeRuntimeHelperWorkspace,
  resolveRuntimeHelperMvpEnabled,
  startRuntimeHelperServer,
} from "./runtime-helper.js";

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
  const mailboxRef: CoordinationTranscriptRefV0 = {
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
  const mailboxRuntime = createMailboxRuntime({
    runId,
    runDir,
    run,
    mailboxRef,
    dispatchMode,
    clock,
    emit,
    onPhase: options.onPhase,
    auditEvents,
    mailbox,
    taskList,
    getMailboxTransport: () => mailboxTransport,
  });
  const {
    sendMailboxMessage,
    recordMailboxMessageEvent,
    auditRuntimeMirrors,
    auditMailboxTransportParity,
    resolveMailboxOrchestrationSource,
  } = mailboxRuntime;

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
      mailboxRef.roomRef = roomRef;
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
    const completedDispatchTaskIds = new Set<string>();
    let previousRole = leadRole.id;
    let lastTask: TaskRecord | null = null;

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
    const controlPlane = createLeadControlPlane({
      runId,
      dispatchMode,
      autoDriveDispatch,
      runtimeHelperMvp,
      taskList,
      adapter: adapter!,
      leadRole,
      leadSessionId: leadSession.sessionId,
      memberRoles,
      memberRoleById,
      validRubricRefs,
      dispatchPlan,
      dispatchPlanByTaskId,
      completedDispatchTaskIds,
      sendMailboxMessage,
      recordMailboxMessageEvent,
      emit,
      resolveSessionId: (roleId) => roleSessionIds.get(roleId),
      setRoleSessionId: (roleId, sessionId) => {
        roleSessionIds.set(roleId, sessionId);
      },
      persistAdapterEvents,
      auditRuntimeMirrors,
      taskInstructionsFor,
      rememberCompletionMessage,
      onDispatchOutput: async (entry, message, output, workerSessionId) => {
        contributions.push({
          roleId: entry.role.id as WorkerContribution["roleId"],
          sessionId: workerSessionId,
          output,
        });
        transitions.push({ from: previousRole, to: entry.role.id, observedAt: clock().toISOString(), source: "task_list" });
        roleCitations.push({ role: entry.role.id, summary: firstNonEmptyLine(output), quote: firstNonEmptyLine(output) });
        previousRole = entry.role.id;
        await emit("spawn_request_executed", {
          messageId: message.id,
          taskId: entry.task.id,
          targetRole: entry.role.id,
          workerSessionId,
          orchestrationSource: dispatchMode,
        }, entry.role.id, workerSessionId);
      },
      setLastTask: (task) => {
        lastTask = task;
      },
    });
    const semanticLeadMessageKinds = new Set<MailboxMessageKind>([
      "evaluator_verdict",
      "spawn_request",
      "worker_complete",
      "final_reconciliation",
    ]);
    const leadWaitRecheckMessageKinds = new Set<MailboxMessageKind>([
      "evaluator_verdict",
      "worker_complete",
      "final_reconciliation",
    ]);
    const resolveRuntimeHelperWaitForRole = async (roleId: string): Promise<boolean> => {
      if (!runtimeHelperServer?.hasPendingWait(roleId)) {
        return false;
      }
      return await runtimeHelperServer.resolvePendingWaitsForRole(roleId);
    };
    const settleLeadRuntimeHelperWaits = async (message: MailboxMessage): Promise<boolean> => {
      const resolvedWait = await resolveRuntimeHelperWaitForRole(leadRole.id);
      if (!leadWaitRecheckMessageKinds.has(message.kind)) {
        return resolvedWait;
      }
      return (await resolveRuntimeHelperWaitForRole(leadRole.id)) || resolvedWait;
    };
    const settleLeadSemanticDelivery = async (message: MailboxMessage): Promise<{
      deliveryMode: "runtime_helper_semantic" | "runtime_helper_wait";
      semanticHandling: string;
    } | null> => {
      if (message.kind === "plan_approval_request") {
        await controlPlane.autoRespondToPlanApproval(message);
        return {
          deliveryMode: await settleLeadRuntimeHelperWaits(message) ? "runtime_helper_wait" : "runtime_helper_semantic",
          semanticHandling: "plan_approval_auto_response",
        };
      }

      if (message.from === "pluto" && message.summary === "RUN_START") {
        return {
          deliveryMode: await settleLeadRuntimeHelperWaits(message) ? "runtime_helper_wait" : "runtime_helper_semantic",
          semanticHandling: "run_start_notice",
        };
      }

      if (!semanticLeadMessageKinds.has(message.kind) || !(await controlPlane.handleLeadSemanticMailboxMessage(message))) {
        return null;
      }

      return {
        deliveryMode: await settleLeadRuntimeHelperWaits(message) ? "runtime_helper_wait" : "runtime_helper_semantic",
        semanticHandling: `lead_${message.kind}`,
      };
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
        },
      });
    }

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
        if (!runtimeHelperMvp || roleId !== leadRole.id) {
          return false;
        }

        return (await settleLeadSemanticDelivery(message)) ?? false;
      },
      onDelivered: async ({ message, roleId }) => {
        try {
          if (message.kind === "plan_approval_request" && roleId === leadRole.id) {
            await controlPlane.autoRespondToPlanApproval(message);
            return;
          }

          if (dispatchMode !== "teamlead_chat" || roleId !== leadRole.id) {
            return;
          }

          if (await controlPlane.handleLeadMailboxMessage(message)) {
            return;
          }
        } catch (error) {
          controlPlane.rejectFinalReconciliation(error);
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

        const { completionMessage, workerSessionId } = await executeDispatchEntry({
          runId,
          dispatchMode,
          entry: { index: dispatchPlan.length, role, task: createdTask },
          adapter,
          taskList,
          leadRoleId: leadRole.id,
          leadSessionId: leadSession.sessionId,
          sendMailboxMessage,
          recordMailboxMessageEvent,
          emit,
          persistAdapterEvents,
          auditRuntimeMirrors,
          taskInstructionsFor,
          setRoleSessionId: (roleId, sessionId) => {
            roleSessionIds.set(roleId, sessionId);
          },
          relayStructuredMessages: false,
          completionMode: "plain_note",
          rememberCompletionMessage,
          beforeCompletion: async ({ output, workerSessionId }) => {
            contributions.push({ roleId: role.id as WorkerContribution["roleId"], sessionId: workerSessionId, output });
            transitions.push({ from: previousRole, to: role.id, observedAt: clock().toISOString(), source: "task_list" });
            roleCitations.push({ role: role.id, summary: firstNonEmptyLine(output), quote: firstNonEmptyLine(output) });
            previousRole = role.id;
          },
        });

        await taskList.complete(createdTask.id, []);
        await emit("task_completed", {
          taskId: createdTask.id,
          messageId: completionMessage!.id,
          orchestrationSource: dispatchMode,
        }, role.id, workerSessionId);
        previousTaskId = createdTask.id;
      }
    } else {
      if (autoDriveDispatch && dispatchPlan[0]) {
        await controlPlane.postSpawnRequest(dispatchPlan[0], "Start the first dispatched task.");
      }
      await controlPlane.finalReconciliationPromise;
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

function hasProbeCapabilities(
  transport: MailboxTransport,
): transport is MailboxTransport & { probeCapabilities: () => Promise<void> } {
  return typeof (transport as { probeCapabilities?: unknown }).probeCapabilities === "function";
}
