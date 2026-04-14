/**
 * Recovery Service — Plan 003 Feature 6
 *
 * On startup, reconstructs run state from events and rebinds
 * Paseo agent sessions. Survives daemon restarts.
 */
import type {
  RunRepository,
  RunEventRepository,
  RunSessionRepository,
  RunRecord,
  RunSessionRecord,
} from "../repositories.js"
import type { RunService } from "./run-service.js"
import type { RuntimeAdapter } from "./runtime-adapter.js"
import type { PhaseController } from "./phase-controller.js"
import type {
  AgentManager,
  AgentPersistenceHandle,
  AgentSessionConfig,
} from "../paseo/types.js"
import { projectRunStateFromEvents } from "./run-service.js"
import { isTerminalRunStatus } from "./run-state-machine.js"

export interface RecoveryServiceDeps {
  runRepository: RunRepository
  runEventRepository: RunEventRepository
  runSessionRepository: RunSessionRepository
  runService: RunService
  runtimeAdapter: RuntimeAdapter
  phaseController: PhaseController
  agentManager: AgentManager
}

export interface RecoveryResult {
  recovered: string[]
  blocked: string[]
  waitingApproval: string[]
  skipped: string[]
}

export class RecoveryService {
  private hasRun = false

  constructor(private readonly deps: RecoveryServiceDeps) {}

  /**
   * Recover all non-terminal runs on startup.
   * Idempotent — safe to call multiple times.
   */
  async recover(): Promise<RecoveryResult> {
    const result: RecoveryResult = {
      recovered: [],
      blocked: [],
      waitingApproval: [],
      skipped: [],
    }

    if (this.hasRun) {
      // Idempotent: second call is a no-op
      return result
    }
    this.hasRun = true

    const allRuns = await this.deps.runRepository.list()
    const nonTerminalRuns = allRuns.filter((run) => !isTerminalRunStatus(run.status))

    for (const run of nonTerminalRuns) {
      const outcome = await this.recoverRun(run.id)

      if (outcome === "waiting_approval") {
        result.waitingApproval.push(run.id)
      } else {
        result[outcome].push(run.id)
      }
    }

    return result
  }

  /**
   * Recover a specific run by ID.
   * Used for targeted recovery after identifying non-terminal runs.
   */
  async recoverRun(runId: string): Promise<"recovered" | "blocked" | "waiting_approval" | "skipped"> {
    const run = await this.deps.runRepository.getById(runId)
    if (!run) return "skipped"

    if (isTerminalRunStatus(run.status)) return "skipped"

    // Step 2: Reconstruct state from events
    const events = await this.deps.runEventRepository.listByRunId(runId)
    const projectedState = projectRunStateFromEvents(events)

    // Runs in waiting_approval don't need a live agent
    if (run.status === "waiting_approval" || projectedState.status === "waiting_approval") {
      return "waiting_approval"
    }

    // Step 3: Check if the Paseo agent still exists
    const sessions = await this.deps.runSessionRepository.listByRunId(runId)
    const activeSession = sessions.find((s) => s.status === "active")

    if (!activeSession) {
      // No active session — mark as blocked
      try {
        await this.deps.runService.transition(runId, "blocked", {
          blockerReason: "runtime session lost, awaiting operator intervention",
        })
      } catch {
        // May already be in a terminal state
      }
      return "blocked"
    }

    const agentId = activeSession.session_id
    const agent = this.deps.agentManager.getAgent?.(agentId)
    const persistenceHandle = activeSession.persistence_handle

    if (agent) {
      // Step 4: Agent exists — rebind
      this.deps.runtimeAdapter.trackRun(runId, agentId)
      this.deps.phaseController.registerRunAgent(runId, agentId)

      if (run.status !== "running") {
        try {
          await this.deps.runService.transition(runId, "running")
        } catch {
          // Some statuses intentionally cannot be resumed automatically.
        }
      }

      return "recovered"
    }

    // Step 5: Agent is gone — try to resume via persistence handle
    if (persistenceHandle) {
      try {
        const resumeFrom = parsePersistenceHandle(persistenceHandle, activeSession.provider)
        const resumedAgent = await this.deps.agentManager.createAgent(
          buildRecoveryAgentConfig(run, activeSession.provider, activeSession.mode_id),
          undefined,
          {
            labels: {
              runId,
              recoveredFrom: activeSession.session_id,
            },
          },
        )

        this.deps.runtimeAdapter.trackRun(runId, resumedAgent.id)
        this.deps.phaseController.registerRunAgent(runId, resumedAgent.id)

        await this.deps.agentManager.runAgent(
          resumedAgent.id,
          "Resume after daemon restart",
          { resumeFrom },
        )

        const timestamp = new Date().toISOString()
        const latestPersistenceHandle = resumedAgent.persistence?.sessionId ?? resumeFrom.sessionId

        await this.deps.runSessionRepository.update({
          ...activeSession,
          session_id: resumedAgent.id,
          provider: resumedAgent.provider,
          persistence_handle: latestPersistenceHandle,
          status: "active",
          updatedAt: timestamp,
        })

        if (run.status !== "running") {
          try {
            await this.deps.runService.transition(runId, "running")
          } catch {
            // If status is already running or cannot transition, keep recovered binding.
          }
        }

        return "recovered"
      } catch (error) {
        return this.blockRun(runId, activeSession, {
          persistenceHandle,
          resumeError: error,
        })
      }
    }

    // Step 6: Cannot resume — mark as blocked
    return this.blockRun(runId, activeSession)
  }

  /** Allow recovery to be re-run (for testing) */
  reset(): void {
    this.hasRun = false
  }

  private async blockRun(
    runId: string,
    activeSession: RunSessionRecord,
    options?: {
      persistenceHandle?: string
      resumeError?: unknown
    },
  ): Promise<"blocked"> {
    const blockerReason = options?.resumeError
      ? `runtime session lost; resume from persistence handle failed: ${options.resumeError instanceof Error ? options.resumeError.message : String(options.resumeError)}`
      : options?.persistenceHandle
        ? "runtime session lost; persistence handle available for resume, awaiting operator intervention"
        : "runtime session lost, awaiting operator intervention"

    try {
      await this.deps.runService.transition(runId, "blocked", {
        blockerReason,
      })
    } catch {
      // May already be blocked
    }

    await this.deps.runSessionRepository.update({
      ...activeSession,
      status: "failed",
      updatedAt: new Date().toISOString(),
    })

    return "blocked"
  }
}

function parsePersistenceHandle(
  persistenceHandle: string,
  provider?: string,
): AgentPersistenceHandle {
  try {
    const parsed = JSON.parse(persistenceHandle) as Partial<AgentPersistenceHandle>

    if (parsed && typeof parsed === "object" && typeof parsed.sessionId === "string") {
      return {
        provider: parsed.provider ?? provider ?? "claude",
        sessionId: parsed.sessionId,
        nativeHandle: parsed.nativeHandle,
        metadata: parsed.metadata,
      }
    }
  } catch {
    // Fall back to legacy plain-string handles.
  }

  return {
    provider: provider ?? "claude",
    sessionId: persistenceHandle,
  }
}

function buildRecoveryAgentConfig(
  run: RunRecord,
  provider?: string,
  modeId?: string,
): AgentSessionConfig {
  return {
    provider: provider ?? "claude",
    cwd: getRecoveryWorkingDirectory(run),
    systemPrompt: [
      `Resume durable control-plane run ${run.id}.`,
      `Playbook: ${run.playbook}`,
      `Harness: ${run.harness}`,
      run.current_phase ? `Current phase: ${run.current_phase}` : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n"),
    title: `Run Recovery: ${run.id}`,
    modeId,
    mcpServers: {},
  }
}

function getRecoveryWorkingDirectory(run: RunRecord): string {
  const environment = run.input.environment

  if (isRecord(environment)) {
    const constraints = environment.constraints

    if (
      isRecord(constraints)
      && typeof constraints.workingDirectory === "string"
      && constraints.workingDirectory.trim().length > 0
    ) {
      return constraints.workingDirectory.trim()
    }
  }

  return process.cwd()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
