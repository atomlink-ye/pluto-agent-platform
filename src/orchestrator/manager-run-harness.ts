import { randomUUID } from "node:crypto";
import { exec as execCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import type { PaseoTeamAdapter } from "../contracts/adapter.js";
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
  EvidenceAuditEvent,
  EvidenceAuditEventKind,
  EvidenceAuditHookBoundary,
  EvidenceCommandResult,
  EvidenceRoleCitation,
  EvidenceTransition,
  MailboxMessage,
  Run,
  RunArtifactRef,
  RunProfile,
  RunProfileAcceptanceCommand,
  RunStatus,
  TaskRecord,
} from "../contracts/four-layer.js";
import { classifyBlocker } from "./blocker-classifier.js";
import { generateEvidencePacket, writeEvidence } from "./evidence.js";
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
  isTrustedPlanApprovalResponse,
  loadFourLayerWorkspace,
  renderAllRolePrompts,
  resolveFourLayerSelection,
  runAcceptanceChecks,
  runAuditMiddleware,
  runHooks,
  writeEvidencePacket,
} from "../four-layer/index.js";
import { captureRuntimeOwnedFileSnapshot } from "../four-layer/runtime-owned-files.js";

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
  createAdapter?: (input: {
    team: TeamConfig;
    workspaceCwd: string;
    scenario: string;
    runProfile?: string;
    playbook: string;
    runId: string;
  }) => Promise<PaseoTeamAdapter> | PaseoTeamAdapter;
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

export async function runManagerHarness(options: ManagerRunHarnessOptions): Promise<ManagerRunHarnessResult> {
  const idGen = options.idGen ?? (() => randomUUID());
  const clock = options.clock ?? (() => new Date());
  const rootDir = resolve(options.rootDir);
  const workspace = await loadFourLayerWorkspace(rootDir);
  const resolved = await resolveFourLayerSelection(workspace, options.selection);
  const runId = idGen();
  const runProfile = resolved.runProfile?.value;
  const taskText = resolveRuntimeTask(resolved.scenario.value.task, options.selection.runtimeTask, resolved.scenario.value.allowTaskOverride);
  const prompts = renderAllRolePrompts(resolved, { runtimeTask: taskText, runId });
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
  const mailboxRef: CoordinationTranscriptRefV0 = {
    kind: "shared_channel",
    path: mailbox.mirrorPath(),
    roomRef: `mailbox:${runId}`,
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
  const auditEvents: EvidenceAuditEvent[] = [];
  const stdoutLines: string[] = [];
  const issues: string[] = [];
  let artifactPath: string | null = null;
  let acceptance: AcceptanceCheckResult = { ok: true, issues: [] };
  let audit: AuditMiddlewareResult = { ok: true, status: "succeeded", issues: [] };
  let blockerReason: BlockerReasonV0 | null = null;
  let adapter: PaseoTeamAdapter | undefined;
  const playbookMetadata = buildPlaybookMetadata(resolved.playbook.value);
  const adapterPlaybook = buildAdapterPlaybook(resolved);
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
    await persistAdapterEvents();

    const memberRoles = team.roles.filter((role) => role.kind === "worker");
    const acceptanceHook = createAcceptanceHook({
      workspaceDir,
      acceptanceCommands: runProfile?.acceptanceCommands ?? [],
      taskList,
    });
    const completionMessages: MailboxMessage[] = [];
    const contributions: WorkerContribution[] = [];
    let previousRole = leadRole.id;
    let previousTaskId: string | undefined;
    let lastTask: TaskRecord | null = null;

    await mailbox.send({
      to: leadRole.id,
      from: "pluto",
      summary: "RUN_START",
      body: `Run ${runId} started. Coordination handle: ${runId}:${leadRole.id}`,
    });

    for (const role of memberRoles) {
      const createdTask = await taskList.create({
        assigneeId: role.id,
        dependsOn: previousTaskId ? [previousTaskId] : [],
        summary: `${role.id}: ${taskText}`,
      });
      lastTask = createdTask;
      await emit("task_created", { taskId: createdTask.id, summary: createdTask.summary, dependsOn: createdTask.dependsOn }, role.id);

      const assignmentMessage = await mailbox.send({
        to: role.id,
        from: leadRole.id,
        summary: `TASK ${createdTask.id}`,
        body: `Task ${createdTask.id}\nRole: ${role.id}\nGoal: ${taskText}\nCoordination handle: ${runId}:${role.id}`,
        replyTo: createdTask.id,
      });
      await emit("mailbox_message", { messageId: assignmentMessage.id, to: role.id, from: leadRole.id, kind: assignmentMessage.kind }, role.id, leadSession.sessionId);

      if (role.id === "planner") {
        const requestBody = createPlanApprovalRequest({
          plan: `Plan for ${createdTask.id}: ${taskText}`,
          requestedMode: "workspace_write",
          taskId: createdTask.id,
        });
        const requestMessage = await mailbox.send({
          to: leadRole.id,
          from: role.id,
          kind: "plan_approval_request",
          summary: `PLAN ${createdTask.id}`,
          body: requestBody,
          replyTo: createdTask.id,
        });
        await emit("plan_approval_requested", { messageId: requestMessage.id, taskId: createdTask.id }, role.id);
        const responseMessage = await mailbox.send({
          to: role.id,
          from: leadRole.id,
          kind: "plan_approval_response",
          summary: `PLAN_APPROVED ${createdTask.id}`,
          body: createPlanApprovalResponse({ approved: true, mode: "workspace_write", taskId: createdTask.id }),
          replyTo: requestMessage.id,
        });
        if (!isTrustedPlanApprovalResponse(responseMessage, leadRole.id)) {
          throw new Error(`untrusted_plan_approval_response:${createdTask.id}`);
        }
        await emit("plan_approval_responded", { messageId: responseMessage.id, taskId: createdTask.id }, role.id);
      }

      const claimedTask = await taskList.claim(createdTask.id, role.id);
      await emit("task_claimed", { taskId: claimedTask.id, claimedBy: role.id }, role.id);

      const idleHook = createIdleNudgeHook({ roleId: role.id, taskList });
      await runHooks([idleHook], { roleId: role.id });
      await auditRuntimeMirrors("teammate_idle");

      await adapter.createWorkerSession({
        runId,
        role,
        instructions: `Task ${createdTask.id}\n${taskText}`,
      });
      const workerEvents = await persistAdapterEvents();
      const completedEvent = [...workerEvents].reverse().find((event) => event.type === "worker_completed" && event.roleId === role.id);
      const output = completedEvent
        ? String(completedEvent.transient?.rawPayload?.output ?? completedEvent.payload.output ?? "")
        : `Contribution from ${role.id}.`;
      contributions.push({ roleId: role.id as WorkerContribution["roleId"], sessionId: completedEvent?.sessionId ?? `${role.id}-session`, output });
      transitions.push({ from: previousRole, to: role.id, observedAt: clock().toISOString(), source: "task_list" });
      roleCitations.push({ role: role.id, summary: firstNonEmptyLine(output), quote: firstNonEmptyLine(output) });
      previousRole = role.id;

      const completionMessage = await mailbox.send({
        to: leadRole.id,
        from: role.id,
        summary: `COMPLETE ${createdTask.id}`,
        body: `Task ${createdTask.id} complete. Output:\n${output}`,
        replyTo: createdTask.id,
      });
      completionMessages.push(completionMessage);
      await emit("mailbox_message", { messageId: completionMessage.id, to: leadRole.id, from: role.id, kind: completionMessage.kind }, role.id, completedEvent?.sessionId);

      await taskList.complete(createdTask.id, []);
      await emit("task_completed", { taskId: createdTask.id, messageId: completionMessage.id }, role.id, completedEvent?.sessionId);
      previousTaskId = createdTask.id;
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
    const finalSummaryMessage = await mailbox.send({
      to: "pluto",
      from: leadRole.id,
      summary: "FINAL",
      body: [
        firstNonEmptyLine(markdown),
        ...completionMessages.map((message) => `${message.from}:${message.id}`),
      ].join("\n"),
    });
    await emit("mailbox_message", { messageId: finalSummaryMessage.id, to: "pluto", from: leadRole.id, kind: finalSummaryMessage.kind }, leadRole.id, leadSession.sessionId);

    const artifact: FinalArtifact = {
      runId,
      markdown,
      leadSummary: firstNonEmptyLine(markdown),
      contributions,
    };
    artifactPath = await store.writeArtifact(artifact);
    await writeFile(join(workspaceDir, "artifact.md"), markdown, "utf8");

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
    await writeFile(finalReportPath, renderFinalReport(markdown, transitions, completionMessages, workspaceDir), "utf8");

    stdoutLines.push(
      `WROTE: artifact.md`,
      `WROTE: ${relative(runDir, taskTreePath)}`,
      `WROTE: ${relative(runDir, statusPath)}`,
      `WROTE: ${relative(runDir, finalReportPath)}`,
      `SUMMARY: ${firstNonEmptyLine(markdown)}`,
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
      summary: firstNonEmptyLine(markdown),
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
      auditEvents,
      acceptance,
      audit,
    });
  } finally {
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
  auditEvents: EvidenceAuditEvent[];
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
      auditEvents: input.auditEvents,
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

function buildSummaryRequest(
  taskText: string,
  contributions: ReadonlyArray<WorkerContribution>,
  completionMessages: ReadonlyArray<MailboxMessage>,
  coordinationHandle: string,
): string {
  return [
    "SUMMARIZE",
    `Task: ${taskText}`,
    `Coordination handle: ${coordinationHandle}`,
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
