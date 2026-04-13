/**
 * Runtime Adapter — Plan 003 Feature 2
 *
 * Subscribes to Paseo AgentManager events and projects them into durable RunEvents.
 * Only tracks agents spawned by the control plane.
 */
import { randomUUID } from "node:crypto"
import type { RunEventEnvelope } from "@pluto-agent-platform/contracts"
import type {
  RunEventRepository,
  RunRepository,
  RunSessionRepository,
  RunSessionRecord,
  ApprovalRepository,
  ApprovalRecord,
} from "../repositories.js"
import type { RunService } from "./run-service.js"
import type {
  AgentManager,
  AgentManagerEvent,
  AgentStreamEvent,
} from "../paseo/types.js"
import type { RuntimeAdapterRegistry } from "./run-compiler.js"

export class RuntimeAdapter implements RuntimeAdapterRegistry {
  /** Maps agentId → runId for tracked agents */
  private trackedAgents = new Map<string, string>()
  /** Maps runId → agentId for reverse lookup */
  private trackedRuns = new Map<string, string>()
  /** Deduplication: set of `${seq}:${epoch}` keys */
  private seenEvents = new Set<string>()

  constructor(
    private readonly agentManager: AgentManager,
    private readonly runEventRepo: RunEventRepository,
    private readonly runRepo: RunRepository,
    private readonly runSessionRepo: RunSessionRepository,
    private readonly approvalRepo: ApprovalRepository,
    private readonly runService: RunService,
  ) {}

  trackRun(runId: string, agentId: string): void {
    this.trackedAgents.set(agentId, runId)
    this.trackedRuns.set(runId, agentId)
  }

  untrackRun(runId: string): void {
    const agentId = this.trackedRuns.get(runId)
    if (agentId) {
      this.trackedAgents.delete(agentId)
    }
    this.trackedRuns.delete(runId)
  }

  isTracked(agentId: string): boolean {
    return this.trackedAgents.has(agentId)
  }

  getRunIdForAgent(agentId: string): string | undefined {
    return this.trackedAgents.get(agentId)
  }

  /**
   * Start listening to Paseo events. Returns an unsubscribe function.
   */
  start(): () => void {
    return this.agentManager.subscribe((event) => {
      this.handleEvent(event).catch((err) => {
        console.error("[RuntimeAdapter] Error handling event:", err)
      })
    })
  }

  private async handleEvent(event: AgentManagerEvent): Promise<void> {
    if (event.type !== "agent_stream") return

    const { agentId, event: streamEvent, seq, epoch } = event

    // Only process tracked agents
    const runId = this.trackedAgents.get(agentId)
    if (!runId) return

    // Deduplication
    if (seq != null && epoch != null) {
      const dedupKey = `${seq}:${epoch}`
      if (this.seenEvents.has(dedupKey)) return
      this.seenEvents.add(dedupKey)
    }

    await this.mapEvent(runId, agentId, streamEvent)
  }

  private async mapEvent(
    runId: string,
    agentId: string,
    event: AgentStreamEvent,
  ): Promise<void> {
    switch (event.type) {
      case "thread_started":
        await this.handleThreadStarted(runId, agentId, event)
        break
      case "turn_started":
        await this.appendRunEvent(runId, "stage.started", {
          provider: event.provider,
          turnId: event.turnId,
        })
        break
      case "turn_completed":
        await this.appendRunEvent(runId, "stage.completed", {
          provider: event.provider,
          usage: event.usage,
          turnId: event.turnId,
        })
        break
      case "turn_failed":
        await this.handleTurnFailed(runId, event)
        break
      case "permission_requested":
        await this.handlePermissionRequested(runId, event)
        break
      case "permission_resolved":
        await this.handlePermissionResolved(runId, event)
        break
      case "attention_required":
        await this.handleAttentionRequired(runId, event)
        break
      // timeline, turn_canceled, usage_updated are not mapped to RunEvents
    }
  }

  private async handleThreadStarted(
    runId: string,
    agentId: string,
    event: Extract<AgentStreamEvent, { type: "thread_started" }>,
  ): Promise<void> {
    await this.appendRunEvent(runId, "session.created", {
      sessionId: event.sessionId,
      provider: event.provider,
      agentId,
    })

    // Upsert RunSession
    const existingSessions = await this.runSessionRepo.listByRunId(runId)
    const existing = existingSessions.find((s) => s.session_id === agentId)
    if (!existing) {
      const sessionRecord: RunSessionRecord = {
        kind: "run_session",
        id: `sess_${randomUUID()}`,
        run_id: runId,
        session_id: agentId,
        provider: event.provider,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      await this.runSessionRepo.save(sessionRecord)
    }
  }

  private async handleTurnFailed(
    runId: string,
    event: Extract<AgentStreamEvent, { type: "turn_failed" }>,
  ): Promise<void> {
    await this.appendRunEvent(runId, "stage.failed", {
      error: event.error,
      code: event.code,
      diagnostic: event.diagnostic,
    })
  }

  private async handlePermissionRequested(
    runId: string,
    event: Extract<AgentStreamEvent, { type: "permission_requested" }>,
  ): Promise<void> {
    // Create an ApprovalTask
    const approval: ApprovalRecord = {
      kind: "approval",
      id: `appr_${randomUUID()}`,
      run_id: runId,
      action_class: mapPermissionKindToActionClass(event.request.kind),
      title: `${event.request.name}: ${event.request.description}`,
      status: "pending",
      requested_by: {
        source: "session",
      },
      context: {
        reason: event.request.description,
      },
      resolution: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await this.approvalRepo.save(approval)

    await this.appendRunEvent(runId, "approval.requested", {
      approvalId: approval.id,
      permissionRequestId: event.request.id,
      kind: event.request.kind,
      name: event.request.name,
      description: event.request.description,
    })

    // Transition run to waiting_approval
    try {
      await this.runService.transition(runId, "waiting_approval")
    } catch {
      // May already be in waiting_approval
    }
  }

  private async handlePermissionResolved(
    runId: string,
    event: Extract<AgentStreamEvent, { type: "permission_resolved" }>,
  ): Promise<void> {
    await this.appendRunEvent(runId, "approval.resolved", {
      requestId: event.requestId,
      allowed: event.resolution.allowed,
      reason: event.resolution.reason,
    })
  }

  private async handleAttentionRequired(
    runId: string,
    event: Extract<AgentStreamEvent, { type: "attention_required" }>,
  ): Promise<void> {
    if (event.reason === "finished") {
      await this.appendRunEvent(runId, "run.completed", {
        reason: "finished",
        timestamp: event.timestamp,
      })
      try {
        await this.runService.transition(runId, "succeeded")
      } catch {
        // May fail if artifacts are missing
      }
    } else if (event.reason === "error") {
      await this.appendRunEvent(runId, "run.failed", {
        reason: "error",
        timestamp: event.timestamp,
      })
      try {
        await this.runService.transition(runId, "failed", {
          failureReason: "Agent reported error",
        })
      } catch {
        // May already be failed
      }
    }
  }

  /**
   * Handle custom MCP tool calls from the lead agent.
   * Called externally when the MCP server receives these tool invocations.
   */
  async handleDeclarePhase(runId: string, phase: string): Promise<void> {
    await this.appendRunEvent(runId, "phase.entered", { phase })

    // Update the run's current phase
    const run = await this.runRepo.getById(runId)
    if (run) {
      run.current_phase = phase
      run.updatedAt = new Date().toISOString()
      await this.runRepo.update(run)
    }
  }

  async handleRegisterArtifact(
    runId: string,
    artifactData: { type: string; title: string; format?: string },
  ): Promise<void> {
    await this.appendRunEvent(runId, "artifact.created", artifactData)
  }

  private async appendRunEvent(
    runId: string,
    eventType: string,
    payload: unknown,
  ): Promise<RunEventEnvelope> {
    const event: RunEventEnvelope = {
      id: `evt_${randomUUID()}`,
      runId,
      eventType,
      occurredAt: new Date().toISOString(),
      source: eventType.startsWith("approval.") ? "operator" : "session",
      payload,
    }
    return this.runEventRepo.append(event)
  }
}

function mapPermissionKindToActionClass(
  kind: string,
): ApprovalRecord["action_class"] {
  switch (kind) {
    case "tool":
      return "destructive_write"
    case "bash":
    case "network":
      return "destructive_write"
    case "mcp":
      return "sensitive_mcp_access"
    default:
      return "destructive_write"
  }
}
