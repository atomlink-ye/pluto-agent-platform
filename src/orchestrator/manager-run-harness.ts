import { randomUUID } from "node:crypto";
import { exec as execCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname, relative, isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import type { PaseoTeamAdapter } from "../contracts/adapter.js";
import type {
  AgentEvent,
  AgentEventType,
  AgentRoleConfig,
  AgentRoleId,
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
  CoordinationChannelRef,
  EvidenceCommandResult,
  EvidenceRoleCitation,
  EvidenceTransition,
  Run,
  RunArtifactRef,
  RunProfileAcceptanceCommand,
  RunProfile,
  RunStatus,
} from "../contracts/four-layer.js";
import { createDefaultCoordinationTranscript } from "./coordination-transcript.js";
import { classifyBlocker } from "./blocker-classifier.js";
import { generateEvidencePacket, writeEvidence } from "./evidence.js";
import { RunStore, sanitizeEventForPersistence } from "./run-store.js";
import type { AcceptanceCheckResult } from "../four-layer/acceptance-runner.js";
import type { AuditMiddlewareResult } from "../four-layer/audit-middleware.js";
import {
  aggregateEvidencePacket,
  runAcceptanceChecks,
  runAuditMiddleware,
  writeEvidencePacket,
  loadFourLayerWorkspace,
  resolveFourLayerSelection,
  renderAllRolePrompts,
} from "../four-layer/index.js";

const exec = promisify(execCallback);

export interface ManagerRunHarnessSelection {
  scenario: string;
  runProfile?: string;
  playbook?: string;
  runtimeTask?: string;
}

const DEFAULT_LEAD_TIMEOUT_SECONDS = 600;

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
  /**
   * When true, the harness observes adapter events to discover lead-spawned
   * workers instead of driving a harness-owned dispatch loop. Falls back to
   * underdispatch-driven spawning if the lead does not produce all required
   * worker completions within the timeout. Default false (fake/legacy compat).
   */
  observeLeadWorkers?: boolean;
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
  const initialWorkspaceDir = resolveWorkspaceDir(rootDir, runProfile?.workspace.cwd, runId, options.workspaceOverride);
  const workspaceDir = resolveWorktreeDir(rootDir, runProfile?.workspace.worktree?.path, initialWorkspaceDir, runId);
  const store = new RunStore({ dataDir: options.dataDir ?? ".pluto" });
  const runDir = store.runDir(runId);
  const transcript = createDefaultCoordinationTranscript({ runId, runDir });
  const taskText = resolveRuntimeTask(resolved.scenario.value.task, options.selection.runtimeTask, resolved.scenario.value.allowTaskOverride);
  const prompts = renderAllRolePrompts(resolved, { runtimeTask: taskText, runId });
  const team = buildTeamConfig(resolved, prompts);
  const adapterPlaybook = buildAdapterPlaybook(resolved);
  const playbookMetadata = buildPlaybookMetadata(resolved.playbook.value);
  const task: TeamTask = {
    id: `manager-run-${runId}`,
    title: resolved.scenario.value.name,
    prompt: taskText,
    workspacePath: workspaceDir,
    artifactPath: join(runDir, "artifact.md"),
    minWorkers: Math.max(2, resolved.members.length),
  };

  const coordinationChannel: CoordinationChannelRef = {
    kind: "transcript",
    locator: transcript.ref.roomRef,
    path: transcript.ref.path,
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
    coordinationChannel,
    artifacts: [],
  };

  const collected: AgentEvent[] = [];
  const transitions: EvidenceTransition[] = [];
  const roleCitations: EvidenceRoleCitation[] = [];
  const commandResults: CommandExecutionResult[] = [];
  let artifactPath: string | null = null;
  const stdoutLines: string[] = [];
  const issues: string[] = [];
  let acceptance: AcceptanceCheckResult = { ok: true, issues: [] };
  let audit: AuditMiddlewareResult = { ok: true, status: "succeeded", issues: [] };
  let legacyResult: TeamRunResult;
  let blockerReason: BlockerReasonV0 | null = null;
  let adapter: PaseoTeamAdapter | undefined;

  const emit = async (type: AgentEventType, payload: Record<string, unknown> = {}, roleId?: string, sessionId?: string) => {
    const event: AgentEvent = sanitizeEventForPersistence({
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
    if (!adapter) return [];
    const events = await adapter.readEvents({ runId });
    for (const event of events) {
      const persisted = sanitizeEventForPersistence(event);
      collected.push(persisted);
      await store.appendEvent(persisted);
    }
    return events;
  };

  try {
    validateRunProfileRuntimeSupport(runProfile);
    await verifyRequiredReads(rootDir, runProfile?.requiredReads ?? []);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const classified = classifyBlocker({ errorMessage: message, source: "orchestrator" });
    blockerReason = classified.reason;
    run.status = "failed";
    run.finishedAt = clock().toISOString();
    legacyResult = {
      runId,
      status: "failed",
      events: collected,
      blockerReason,
      failure: { message, cause: error },
    };
    return {
      run,
      legacyResult,
      runDir,
      workspaceDir,
      artifactPath,
      canonicalEvidencePath: join(runDir, "evidence-packet.json"),
      legacyEvidencePath: join(runDir, "evidence.json"),
      stdoutPath: join(runDir, "stdout.log"),
      finalReportPath: join(runDir, "final-report.md"),
    };
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
    run.status = "running";
    run.startedAt = clock().toISOString();
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "workspace-materialization.json"), JSON.stringify({
      runId,
      repoRoot: rootDir,
      workspaceDir,
      worktreeDir: workspaceDir,
      runProfile: resolved.runProfile?.value.name ?? null,
    }, null, 2) + "\n", "utf8");
    await emit("run_started", {
      taskId: task.id,
      title: task.title,
      prompt: task.prompt,
      playbook: playbookMetadata,
      playbookId: resolved.playbook.value.name,
      orchestrationMode: "teamlead_direct",
      orchestrationSource: "teamlead_direct",
      transcript: transcript.ref,
      scenario: resolved.scenario.value.name,
      runProfile: resolved.runProfile?.value.name ?? null,
    });
    await emit("coordination_transcript_created", {
      transcript: transcript.ref,
      playbookId: resolved.playbook.value.name,
      scenario: resolved.scenario.value.name,
    });
    await adapter.startRun({ runId, task, team, playbook: adapterPlaybook, transcript: transcript.ref });
    const leadRole = team.roles.find((role) => role.id === team.leadRoleId)!;
    const leadSession = await adapter.createLeadSession({ runId, task, role: leadRole, playbook: adapterPlaybook, transcript: transcript.ref });
    await transcript.append({
      runId,
      ts: clock().toISOString(),
      source: "pluto",
      type: "lead_started",
      message: `Lead session started for ${resolved.playbook.value.name}.`,
      payload: { sessionId: leadSession.sessionId },
    });
    await persistAdapterEvents();

    const workerRoles = team.roles.filter((role) => role.kind === "worker");
    const deviations = extractDeviations(collected);
    const requiredRoles = new Set(workerRoles.map((r) => r.id));
    const completedRoles = new Set<string>();
    const contributions: WorkerContribution[] = [];
    let previousRole = leadRole.id;

    if (options.observeLeadWorkers) {
      const leadTimeoutMs = extractLeadTimeoutSeconds(runProfile) * 1000;
      const observationStartedAt = Date.now();
      const underdispatchMs = Math.min(leadTimeoutMs - 1_000, 15_000);
      let underdispatchTriggered = false;

      while (completedRoles.size < requiredRoles.size) {
        if (Date.now() - observationStartedAt > leadTimeoutMs) {
          throw new Error(`lead_timeout:exceeded ${leadTimeoutMs}ms`);
        }
        const adapterEvents = await persistAdapterEvents();
        for (const event of adapterEvents) {
          if (event.type === "worker_completed" && event.roleId && requiredRoles.has(event.roleId) && !completedRoles.has(event.roleId)) {
            completedRoles.add(event.roleId);
            const c = collectContribution(event, previousRole);
            contributions.push(c.contribution);
            transitions.push(c.transition);
            roleCitations.push(c.citation);
            previousRole = c.nextRole;
            await transcript.append({
              runId, ts: clock().toISOString(), source: "worker",
              type: "stage_output", message: `${event.roleId} completed.`,
              payload: { output: c.contribution.output },
            });
          }
        }
        if (!underdispatchTriggered && completedRoles.size < requiredRoles.size && Date.now() - observationStartedAt > underdispatchMs) {
          underdispatchTriggered = true;
          await emit("orchestrator_underdispatch_fallback", {
            missingRoles: workerRoles.filter((r) => !completedRoles.has(r.id)).map((r) => r.id),
            reason: "lead_underdispatched_required_workers",
          });
          for (const role of workerRoles.filter((r) => !completedRoles.has(r.id))) {
            const instructions = buildWorkerInstructions({ roleId: role.id, task: taskText, previousContributions: contributions });
            await transcript.append({
              runId, ts: clock().toISOString(), source: "teamlead",
              type: "stage_request", message: `Requested ${role.id}.`,
              payload: { targetRole: role.id },
            });
            await dispatchViaAdapter(adapter, runId, role, instructions, contributions, transcript.ref);
            await persistAdapterEvents();
            const completed = [...collected].reverse().find((e) => e.type === "worker_completed" && e.roleId === role.id);
            if (completed) {
              completedRoles.add(role.id);
              const c = collectContribution(completed, previousRole);
              contributions.push(c.contribution);
              transitions.push(c.transition);
              roleCitations.push(c.citation);
              previousRole = c.nextRole;
              await transcript.append({
                runId, ts: clock().toISOString(), source: "worker",
                type: "stage_output", message: `${role.id} completed.`,
                payload: { output: c.contribution.output },
              });
            }
          }
        }
        await delay(50);
      }
    } else {
      for (const role of workerRoles) {
        const instructions = buildWorkerInstructions({
          roleId: role.id,
          task: taskText,
          previousContributions: contributions,
        });
        await transcript.append({
          runId,
          ts: clock().toISOString(),
          source: "teamlead",
          type: "stage_request",
          message: `Requested ${role.id}.`,
          payload: { targetRole: role.id },
        });
        await dispatchViaAdapter(adapter, runId, role, instructions, contributions, transcript.ref);
        const events = await persistAdapterEvents();
        const completed = [...events].reverse().find((event) => event.type === "worker_completed" && event.roleId === role.id);
        if (completed) {
          completedRoles.add(role.id);
          const c = collectContribution(completed, previousRole);
          contributions.push(c.contribution);
          transitions.push(c.transition);
          roleCitations.push(c.citation);
          previousRole = c.nextRole;
          await transcript.append({
            runId,
            ts: clock().toISOString(),
            source: "worker",
            type: "stage_output",
            message: `${role.id} completed.`,
            payload: { output: c.contribution.output },
          });
        }
      }
    }

    transitions.push({
      from: previousRole,
      to: leadRole.id,
      observedAt: clock().toISOString(),
      source: "manager_run_harness",
    });

    await adapter.sendMessage({
      runId,
      sessionId: leadSession.sessionId,
      message: buildSummaryRequest(taskText, contributions, transcript.ref.path),
    });
    await persistAdapterEvents();

    let markdown: string;
    const leadSummaryEvent = [...collected].reverse().find((event) => event.type === "lead_message");
    if (leadSummaryEvent) {
      markdown = String(leadSummaryEvent.transient?.rawPayload?.markdown ?? leadSummaryEvent.payload.markdown ?? "");
    } else {
      const leadText = extractLeadTextOutput(collected);
      markdown = leadText || buildFallbackSummary(taskText, contributions);
    }

    const artifact: FinalArtifact = {
      runId,
      markdown,
      leadSummary: firstNonEmptyLine(markdown),
      contributions,
    };
    artifactPath = await store.writeArtifact(artifact);
    await writeFile(join(workspaceDir, "artifact.md"), markdown, "utf8");
    const taskTreePath = join(runDir, "task-tree.md");
    const statusPath = join(runDir, "status.md");
    const finalReportPath = join(runDir, "final-report.md");
    await writeFile(taskTreePath, renderTaskTree(resolved.playbook.value.name, [leadRole.id, ...resolved.members.map((member) => member.value.name)]), "utf8");
    await writeFile(statusPath, renderStatusDoc(runId, resolved, workspaceDir, artifactPath), "utf8");
    await writeFile(finalReportPath, renderFinalReport({ resolved, transitions, roleCitations, deviations, summary: markdown, workspaceDir }), "utf8");
    for (const transition of transitions) {
      stdoutLines.push(`STAGE: ${transition.from} -> ${transition.to}`);
    }
    stdoutLines.push(
      `WROTE: ${relative(runDir, artifactPath) || "artifact.md"}`,
      `WROTE: ${relative(runDir, taskTreePath)}`,
      `WROTE: ${relative(runDir, statusPath)}`,
      `WROTE: ${relative(runDir, finalReportPath)}`,
      `SUMMARY: ${firstNonEmptyLine(markdown)}`,
    );

    const artifactRefs: RunArtifactRef[] = [
      { path: artifactPath, label: "artifact" },
      { path: taskTreePath, label: "task_tree" },
      { path: statusPath, label: "status" },
      { path: finalReportPath, label: "final_report" },
    ];
    run.artifacts = artifactRefs;

    for (const command of runProfile?.acceptanceCommands ?? []) {
      const result = await executeAcceptanceCommand(command, workspaceDir, runDir, commandResults.length + 1, clock);
      commandResults.push(result);
      stdoutLines.push(`CMD: ${result.cmd} -> ${result.exitCode}`);
      if (result.exitCode !== 0 && !result.blockerOk) {
        issues.push(`acceptance command failed: ${result.cmd}`);
      }
    }
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
      stageTransitions: transitions.map((transition) => ({ from: transition.from, to: transition.to, observedAt: transition.observedAt })),
      stageTransitionSource: "observed_lead_output",
      revisionCount: countObservedRevisionCycles(collected),
      finalReportPath: "final-report.md",
    });
    issues.push(...audit.issues.map((issue) => issue.message));

    run.status = resolveRunStatus(issues, audit.ok);
    run.finishedAt = clock().toISOString();
    const resultStatus: TeamRunResult["status"] = run.status === "succeeded" ? "completed" : "failed";
    legacyResult = {
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
        dependencyTrace: transitions.map((transition, index) => ({
          stageId: `${index}-${transition.to}`,
          role: transition.to,
          completedAt: transition.observedAt,
        })),
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
      transcriptRef: transcript.ref,
    });
    await writeEvidence(runDir, legacyEvidence);

    const canonicalPacket = aggregateEvidencePacket({
      run,
      summary: firstNonEmptyLine(markdown),
      failureReason: issues.length > 0 ? issues.join("; ") : null,
      issues,
      artifactRefs,
      commandResults,
      transitions,
      roleCitations: roleCitations.map((citation) => ({ ...citation, artifactPath: citation.artifactPath ?? artifactPath ?? undefined })),
      acceptance,
      audit,
      stdoutPath,
      transcriptPath: transcript.ref.path,
      finalReportPath,
    });
    const canonicalEvidence = await writeEvidencePacket(runDir, canonicalPacket);
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
    const classified = classifyBlocker({ errorMessage: message, source: "orchestrator" });
    blockerReason = classified.reason;
    run.status = "failed";
    run.finishedAt = clock().toISOString();
    issues.push(message);
    await emit("blocker", { reason: blockerReason, message });
    await emit("run_failed", { message });
    legacyResult = {
      runId,
      status: "failed",
      events: collected,
      blockerReason,
      failure: { message, cause: error },
    };
    const stdoutPath = join(runDir, "stdout.log");
    await writeFile(stdoutPath, issues.join("\n") + "\n", "utf8");
    const legacyEvidence = generateEvidencePacket({
      task,
      result: legacyResult,
      events: collected,
      startedAt: new Date(run.startedAt ?? clock().toISOString()),
      finishedAt: new Date(run.finishedAt),
      blockerReason,
      transcriptRef: transcript.ref,
    });
    await writeEvidence(runDir, legacyEvidence);
    const canonicalPacket = aggregateEvidencePacket({
      run,
      failureReason: message,
      issues,
      commandResults,
      transitions,
      roleCitations,
      stdoutPath,
      transcriptPath: transcript.ref.path,
    });
    const canonicalEvidence = await writeEvidencePacket(runDir, canonicalPacket);
    return {
      run,
      legacyResult,
      runDir,
      workspaceDir,
      artifactPath,
      canonicalEvidencePath: canonicalEvidence.jsonPath,
      legacyEvidencePath: join(runDir, "evidence.json"),
      stdoutPath,
      finalReportPath: join(runDir, "final-report.md"),
    };
  } finally {
    await adapter?.endRun({ runId }).catch(() => undefined);
  }
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
  const cwd = interpolatePath(configuredCwd ?? join(rootDir, ".tmp", "manager-runs", runId), rootDir, runId, rootDir);
  return resolve(cwd);
}

function resolveWorktreeDir(rootDir: string, worktreePath: string | undefined, workspaceDir: string, runId: string): string {
  if (!worktreePath) return workspaceDir;
  return resolve(interpolatePath(worktreePath, rootDir, runId, workspaceDir));
}

function interpolatePath(value: string, rootDir: string, runId: string, cwd: string): string {
  return value
    .replaceAll("${repo_root}", rootDir)
    .replaceAll("${run_id}", runId)
    .replaceAll("${cwd}", cwd);
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
    instructions: `Follow the selected playbook workflow as ${member.value.name} for scenario ${resolved.scenario.value.name}.`,
    dependsOn: index === 0 ? [] : [`${resolved.members[index - 1]!.value.name}-stage`],
    evidenceCitation: {
      required: true,
      label: member.value.name,
    },
  })) satisfies TeamPlaybookV0["stages"];

  const generatorStage = stages.find((stage) => stage.roleId === "generator");
  const evaluatorStage = stages.find((stage) => stage.roleId === "evaluator");
  const maxRevisionCycles = resolved.playbook.value.audit?.maxRevisionCycles ?? 0;

  return {
    schemaVersion: 0,
    id: resolved.playbook.value.name,
    title: resolved.playbook.value.description ?? resolved.playbook.value.name,
    description: resolved.playbook.value.workflow,
    orchestrationSource: "teamlead_direct",
    stages,
    revisionRules: generatorStage && evaluatorStage && maxRevisionCycles > 0
      ? [{
          fromStageId: evaluatorStage.id,
          targetStageId: generatorStage.id,
          maxRevisionCycles,
          failureSignal: "FAIL:",
        }]
      : [],
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

interface ContributionRecord {
  contribution: WorkerContribution;
  transition: EvidenceTransition;
  citation: EvidenceRoleCitation;
  nextRole: AgentRoleId;
}

function collectContribution(event: AgentEvent, previousRole: AgentRoleId): ContributionRecord {
  const output = String(event.transient?.rawPayload?.output ?? event.payload.output ?? "");
  return {
    contribution: {
      roleId: event.roleId as WorkerContribution["roleId"],
      sessionId: event.sessionId ?? `${event.roleId}-session`,
      output,
    },
    transition: {
      from: previousRole,
      to: event.roleId!,
      observedAt: event.ts ?? new Date().toISOString(),
      source: "worker_completed_event",
    },
    citation: {
      role: event.roleId!,
      summary: firstNonEmptyLine(output),
      quote: firstNonEmptyLine(output),
    },
    nextRole: event.roleId!,
  };
}

async function dispatchViaAdapter(
  adapter: PaseoTeamAdapter,
  runId: string,
  role: AgentRoleConfig,
  instructions: string,
  contributions: ReadonlyArray<WorkerContribution>,
  transcriptRef: CoordinationTranscriptRefV0,
): Promise<void> {
  if (adapter.spawnTeammate) {
    try {
      await adapter.spawnTeammate({
        runId,
        stageId: `${role.id}-stage`,
        role,
        instructions,
        dependencies: contributions.map((c) => c.roleId),
        transcript: transcriptRef,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("spawnTeammate not supported in this runtime")) throw error;
    }
  }
  await adapter.createWorkerSession({ runId, role, instructions });
}

function buildWorkerInstructions(input: { roleId: string; task: string; previousContributions: ReadonlyArray<WorkerContribution> }): string {
  return [
    `Role: ${input.roleId}`,
    `Task: ${input.task}`,
    ...(input.previousContributions.length > 0
      ? [
          "Previous role outputs:",
          ...input.previousContributions.map((contribution) => `- ${contribution.roleId}: ${firstNonEmptyLine(contribution.output)}`),
        ]
      : []),
    "Return a concise contribution for the final artifact.",
  ].join("\n");
}

function buildSummaryRequest(taskText: string, contributions: ReadonlyArray<WorkerContribution>, transcriptPath: string): string {
  return [
    "SUMMARIZE",
    `Task: ${taskText}`,
    `Transcript: ${transcriptPath}`,
    "Contributions:",
    ...contributions.map((contribution) => `- ${contribution.roleId}: ${firstNonEmptyLine(contribution.output)}`),
  ].join("\n");
}

function buildFallbackSummary(taskText: string, contributions: ReadonlyArray<WorkerContribution>): string {
  return [
    `# ${taskText}`,
    "",
    "## Worker contributions",
    ...contributions.flatMap((contribution) => [`### ${contribution.roleId}`, contribution.output, ""]),
  ].join("\n");
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
    if (entry.optional) {
      continue;
    }
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

// v1.5 lead observation helpers — ready for live adapter path where the lead
// drives worker spawning itself. Currently the fake-adapter path drives
// workers through the harness loop above.
function extractLeadTimeoutSeconds(runProfile: RunProfile | undefined): number {
  const raw = (runProfile as Record<string, unknown> | undefined)?.runtime as Record<string, unknown> | undefined;
  if (typeof raw?.lead_timeout_seconds === "number" && raw.lead_timeout_seconds > 0) {
    return raw.lead_timeout_seconds;
  }
  return DEFAULT_LEAD_TIMEOUT_SECONDS;
}

async function observeLeadCompletion(input: {
  adapter: PaseoTeamAdapter;
  runId: string;
  collected: AgentEvent[];
  persistAdapterEvents: () => Promise<AgentEvent[]>;
  timeoutMs: number;
}): Promise<AgentEvent[]> {
  const deadline = Date.now() + input.timeoutMs;
  const leadDone = (events: AgentEvent[]) =>
    events.some((e) => e.type === "lead_message" && String(e.payload.kind) === "summary");

  if (leadDone(input.collected)) return input.collected;

  while (Date.now() < deadline) {
    const remaining = Math.max(100, deadline - Date.now());
    const batch = await input.adapter.waitForCompletion({ runId: input.runId, timeoutMs: Math.min(remaining, 30_000) });
    input.collected.push(...batch);
    if (leadDone(input.collected)) return input.collected;
    await delay(1_000);
    await input.persistAdapterEvents();
    if (leadDone(input.collected)) return input.collected;
  }

  throw new Error(`lead_timeout:exceeded ${input.timeoutMs}ms`);
}

function extractStageTransitions(events: ReadonlyArray<AgentEvent>): EvidenceTransition[] {
  const transitions: EvidenceTransition[] = [];
  for (const event of events) {
    if (event.type !== "lead_message") continue;
    for (const value of extractEventTextValues(event)) {
      for (const line of value.split(/\r?\n/)) {
        const match = /^STAGE:\s*(\S+)\s*->\s*(\S+)$/i.exec(line.trim());
        if (match) {
          transitions.push({
            from: match[1]!,
            to: match[2]!,
            observedAt: event.ts,
            source: "lead_output",
          });
        }
      }
    }
  }
  if (transitions.length === 0) {
    const workerCompleted = events.filter((e) => e.type === "worker_completed");
    for (const event of workerCompleted) {
      transitions.push({
        from: "lead",
        to: event.roleId ?? "unknown",
        observedAt: event.ts,
        source: "worker_completed_event",
      });
    }
  }
  return transitions;
}

function extractDeviations(events: ReadonlyArray<AgentEvent>): string[] {
  const deviations = new Set<string>();
  for (const event of events) {
    if (event.type !== "lead_message") continue;
    for (const value of extractEventTextValues(event)) {
      for (const line of value.split(/\r?\n/)) {
        const match = /^DEVIATION:\s*(.+)$/i.exec(line.trim());
        if (match) {
          deviations.add(match[1]!);
        }
      }
    }
  }
  return [...deviations];
}

function extractLeadTextOutput(events: ReadonlyArray<AgentEvent>): string {
  for (const event of [...events].reverse()) {
    if (event.type === "lead_message" && event.transient?.rawPayload?.markdown) {
      return String(event.transient.rawPayload.markdown);
    }
    if (event.type === "lead_message" && event.payload.markdown) {
      return String(event.payload.markdown);
    }
  }
  return "";
}

// Legacy v1 bridge helpers — kept for backward compatibility but no longer
// called from the mainline path. The fake adapter still emits worker_requested
// events synchronously; the new harness observes lead output instead of
// collecting worker intent.
async function waitForWorkerRequests(input: {
  adapter: PaseoTeamAdapter;
  runId: string;
  collected: AgentEvent[];
  persistAdapterEvents: () => Promise<AgentEvent[]>;
  expectedCount: number;
}): Promise<AgentEvent[]> {
  const deadline = Date.now() + 5_000;
  let requests = input.collected.filter((event) => event.type === "worker_requested");
  while (requests.length < input.expectedCount && Date.now() < deadline) {
    await delay(100);
    await input.persistAdapterEvents();
    requests = input.collected.filter((event) => event.type === "worker_requested");
  }
  if (requests.length === 0) {
    throw new Error("worker_intent_missing:any");
  }
  if (requests.length < input.expectedCount) {
    const observed = requests
      .map((event) => String(event.payload.targetRole ?? event.roleId ?? "unknown"))
      .join(",");
    throw new Error(`worker_intent_incomplete:expected=${input.expectedCount}:observed=${observed || "none"}`);
  }
  return requests.slice(0, input.expectedCount);
}

function countObservedRevisionCycles(events: ReadonlyArray<AgentEvent>): number {
  const started = events.filter((event) => event.type === "revision_started").length;
  const completed = events.filter((event) => event.type === "revision_completed").length;
  const requestCounts = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "worker_requested") continue;
    const roleId = typeof event.payload.targetRole === "string" ? event.payload.targetRole : event.roleId;
    if (!roleId) continue;
    requestCounts.set(roleId, (requestCounts.get(roleId) ?? 0) + 1);
  }
  const inferred = [...requestCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  return Math.max(started, completed, inferred);
}

// The shipped v1 harness is a lead-intent bridge: it records routed worker intent and
// completions, then synthesizes workflow/deviation reporting from that record plus any
// explicit `DEVIATION:` lines emitted by the lead. It does not observe a live
// STAGE/DEVIATION event stream yet.
function synthesizeDeviations(input: {
  events: ReadonlyArray<AgentEvent>;
  workerRequests: ReadonlyArray<AgentEvent>;
  expectedRoles: ReadonlyArray<string>;
}): string[] {
  const deviations = new Set<string>();

  for (const [index, request] of input.workerRequests.entries()) {
    const observedRole = typeof request.payload.targetRole === "string" ? request.payload.targetRole : request.roleId;
    const expectedRole = input.expectedRoles[index];
    if (observedRole && expectedRole && observedRole !== expectedRole) {
      deviations.add(`routing step ${index + 1} expected ${expectedRole} but launched ${observedRole}`);
    }
    const orchestratorSource = typeof request.payload.orchestratorSource === "string"
      ? request.payload.orchestratorSource
      : null;
    if (observedRole && orchestratorSource && orchestratorSource !== "teamlead_direct") {
      deviations.add(`routing for ${observedRole} used ${orchestratorSource} instead of teamlead_direct`);
    }
  }

  for (const event of input.events) {
    if (event.type !== "lead_message") continue;
    for (const value of extractEventTextValues(event)) {
      for (const line of value.split(/\r?\n/)) {
        const match = /^DEVIATION:\s*(.+)$/i.exec(line.trim());
        if (match) {
          deviations.add(match[1]!);
        }
      }
    }
  }

  return [...deviations];
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
    await mkdir(dirname(stdoutPath), { recursive: true });
    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, stderr, "utf8");
    return {
      cmd: spec.cmd,
      exitCode: 0,
      summary: "ok",
      stdout,
      stderr,
      stdoutPath,
      stderrPath,
      blockerOk: spec.blockerOk,
      startedAt,
      finishedAt: clock().toISOString(),
    };
  } catch (error) {
    const stdout = typeof error === "object" && error !== null && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";
    const exitCode = typeof error === "object" && error !== null && "code" in error ? Number((error as { code?: number }).code ?? 1) : 1;
    const stdoutPath = join(runDir, `command-${index}.stdout.log`);
    const stderrPath = join(runDir, `command-${index}.stderr.log`);
    await writeFile(stdoutPath, stdout, "utf8");
    await writeFile(stderrPath, stderr, "utf8");
    return {
      cmd: spec.cmd,
      exitCode,
      summary: spec.blockerOk ? "blocker_ok" : "failed",
      stdout,
      stderr,
      stdoutPath,
      stderrPath,
      blockerOk: spec.blockerOk,
      startedAt,
      finishedAt: clock().toISOString(),
    };
  }
}

function resolveRunStatus(issues: string[], auditOk: boolean): RunStatus {
  if (!auditOk) return "failed_audit";
  if (issues.length > 0) return "failed";
  return "succeeded";
}

function renderTaskTree(playbookName: string, roles: string[]): string {
  return [
    `# Task Tree — ${playbookName}`,
    "",
    ...roles.map((role, index) => `${index + 1}. ${role}`),
    "",
  ].join("\n");
}

function renderStatusDoc(
  runId: string,
  resolved: Awaited<ReturnType<typeof resolveFourLayerSelection>>,
  workspaceDir: string,
  artifactPath: string,
): string {
  return [
    `# Status — ${runId}`,
    "",
    `- Scenario: ${resolved.scenario.value.name}`,
    `- Playbook: ${resolved.playbook.value.name}`,
    `- Run profile: ${resolved.runProfile?.value.name ?? "(none)"}`,
    `- Workspace: ${workspaceDir}`,
    `- Artifact: ${artifactPath}`,
    "",
  ].join("\n");
}

function renderFinalReport(input: {
  resolved: Awaited<ReturnType<typeof resolveFourLayerSelection>>;
  transitions: EvidenceTransition[];
  roleCitations: EvidenceRoleCitation[];
  deviations: ReadonlyArray<string>;
  summary: string;
  workspaceDir: string;
}): string {
  return [
    "# Final Report",
    "",
    "## Implementation Summary",
    firstNonEmptyLine(input.summary) || "Completed.",
    "",
    "## Workflow Steps Executed",
    ...(input.transitions.length > 0
      ? input.transitions.map((transition) => `- ${transition.from} -> ${transition.to}`)
      : ["- no stage transitions observed"]),
    "",
    "## Required Role Citations",
    ...input.roleCitations.map((citation) => `- ${citation.role}: ${citation.summary ?? "(none)"}`),
    "",
    "## Deviations",
    ...(input.deviations.length > 0 ? input.deviations.map((deviation) => `- ${deviation}`) : ["- none observed"]),
    "",
    "## Workspace",
    `- ${input.workspaceDir}`,
    "",
  ].join("\n");
}

function extractEventTextValues(event: AgentEvent): string[] {
  const values: string[] = [];
  const pushStrings = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") return;
    for (const value of Object.values(candidate)) {
      if (typeof value === "string") {
        values.push(value);
      }
    }
  };

  pushStrings(event.payload);
  pushStrings(event.transient?.rawPayload);
  return values;
}

function firstNonEmptyLine(value: string): string {
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    return line.replace(/^#+\s*/, "");
  }
  return "";
}
