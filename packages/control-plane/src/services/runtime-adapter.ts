import { randomUUID } from "node:crypto"

import type { ApprovalDecision, RunEventEnvelope } from "@pluto-agent-platform/contracts"

import type {
  ApprovalRecord,
  ApprovalRepository,
  RunEventRepository,
  RunSessionRecord,
  RunSessionRepository,
} from "../repositories.js"
import type {
  AgentManager,
  AgentManagerEvent,
  AgentStreamEvent,
  AgentTimelineItem,
} from "../paseo/types.js"
import type { RuntimeAdapterRegistry } from "./run-compiler.js"
import type { RunService } from "./run-service.js"

type TimelineToolCall =
  | { kind: "declare_phase"; phase: string }
  | { kind: "register_artifact"; artifact: Record<string, unknown> }

export class RuntimeAdapter implements RuntimeAdapterRegistry {
  private readonly trackedRunByAgentId = new Map<string, string>()
  private readonly trackedAgentIdByRunId = new Map<string, string>()
  private readonly seenEventKeys = new Set<string>()
  private unsubscribe?: () => void

  constructor(
    private readonly agentManager: AgentManager,
    private readonly runEventRepo: RunEventRepository,
    private readonly approvalRepo: ApprovalRepository,
    private readonly runService: RunService,
    private readonly runSessionRepo: RunSessionRepository,
  ) {}

  trackRun(runId: string, agentId: string): void {
    const previousAgentId = this.trackedAgentIdByRunId.get(runId)

    if (previousAgentId && previousAgentId !== agentId) {
      this.trackedRunByAgentId.delete(previousAgentId)
    }

    this.trackedRunByAgentId.set(agentId, runId)
    this.trackedAgentIdByRunId.set(runId, agentId)
  }

  untrackRun(runId: string): void {
    const agentId = this.trackedAgentIdByRunId.get(runId)

    if (agentId) {
      this.trackedRunByAgentId.delete(agentId)
    }

    this.trackedAgentIdByRunId.delete(runId)
  }

  isTracked(agentId: string): boolean {
    return this.trackedRunByAgentId.has(agentId)
  }

  getRunIdForAgent(agentId: string): string | undefined {
    return this.trackedRunByAgentId.get(agentId)
  }

  start(): () => void {
    if (this.unsubscribe) {
      return this.unsubscribe
    }

    const stop = this.agentManager.subscribe((event) => {
      void this.handleManagerEvent(event)
    })

    this.unsubscribe = () => {
      stop()
      this.unsubscribe = undefined
    }

    return this.unsubscribe
  }

  private async handleManagerEvent(event: AgentManagerEvent): Promise<void> {
    if (event.type !== "agent_stream") {
      return
    }

    const runId = this.trackedRunByAgentId.get(event.agentId)

    if (!runId) {
      return
    }

    const dedupeKey = this.buildDedupeKey(event.agentId, event.seq, event.epoch)

    if (dedupeKey) {
      if (this.seenEventKeys.has(dedupeKey)) {
        return
      }

      this.seenEventKeys.add(dedupeKey)
    }

    await this.handleStreamEvent(runId, event.agentId, event.event)
  }

  private buildDedupeKey(agentId: string, seq?: number, epoch?: string): string | null {
    if (seq == null || epoch == null) {
      return null
    }

    return `${agentId}:${epoch}:${seq}`
  }

  private async handleStreamEvent(
    runId: string,
    agentId: string,
    event: AgentStreamEvent,
  ): Promise<void> {
    switch (event.type) {
      case "thread_started":
        await this.handleThreadStarted(runId, agentId, event)
        return
      case "turn_started":
        await this.appendRunEvent({
          runId,
          eventType: "stage.started",
          source: "session",
          phase: event.phase ?? null,
          stageId: event.stageId ?? null,
          payload: {
            provider: event.provider,
            turnId: event.turnId,
          },
        })
        return
      case "turn_completed":
        await this.appendRunEvent({
          runId,
          eventType: "stage.completed",
          source: "session",
          phase: event.phase ?? null,
          stageId: event.stageId ?? null,
          payload: {
            provider: event.provider,
            turnId: event.turnId,
            usage: event.usage,
          },
        })
        return
      case "turn_failed":
        await this.handleTurnFailed(runId, event)
        return
      case "turn_canceled":
        return
      case "permission_requested":
        await this.handlePermissionRequested(runId, event)
        return
      case "permission_resolved":
        await this.handlePermissionResolved(runId, event)
        return
      case "attention_required":
        await this.handleAttentionRequired(runId, event)
        return
      case "timeline":
        await this.handleTimelineEvent(runId, event)
        return
    }
  }

  private async handleThreadStarted(
    runId: string,
    agentId: string,
    event: Extract<AgentStreamEvent, { type: "thread_started" }>,
  ): Promise<void> {
    await this.upsertRunSession(runId, agentId, event.provider)

    await this.appendRunEvent({
      runId,
      eventType: "session.created",
      source: "session",
      sessionId: event.sessionId,
      payload: {
        runtimeSessionId: event.sessionId,
        agentId,
        provider: event.provider,
      },
    })
  }

  private async upsertRunSession(
    runId: string,
    agentId: string,
    provider: string,
  ): Promise<RunSessionRecord> {
    const sessions = await this.runSessionRepo.listByRunId(runId)
    const existing = sessions.find((session) => session.session_id === agentId)
    const timestamp = new Date().toISOString()

    if (existing) {
      return this.runSessionRepo.update({
        ...existing,
        provider,
        status: "active",
        updatedAt: timestamp,
      })
    }

    return this.runSessionRepo.save({
      kind: "run_session",
      id: `sess_${randomUUID()}`,
      run_id: runId,
      session_id: agentId,
      provider,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  private async handleTurnFailed(
    runId: string,
    event: Extract<AgentStreamEvent, { type: "turn_failed" }>,
  ): Promise<void> {
    const isRunFailure = event.severity === "run" || event.severity === "fatal"

    await this.appendRunEvent({
      runId,
      eventType: isRunFailure ? "run.failed" : "stage.failed",
      source: "session",
      phase: event.phase ?? null,
      stageId: event.stageId ?? null,
      payload: {
        provider: event.provider,
        turnId: event.turnId,
        error: event.error,
        code: event.code,
        diagnostic: event.diagnostic,
        severity: event.severity,
      },
    })

    if (isRunFailure) {
      await this.tryTransition(runId, "failed", {
        failureReason: event.error,
      })
    }
  }

  private async handlePermissionRequested(
    runId: string,
    event: Extract<AgentStreamEvent, { type: "permission_requested" }>,
  ): Promise<void> {
    const timestamp = new Date().toISOString()
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
      metadata: {
        permissionRequestId: event.request.id,
        permissionKind: event.request.kind,
        permissionName: event.request.name,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const savedApproval = await this.approvalRepo.save(approval)

    await this.appendRunEvent({
      runId,
      eventType: "approval.requested",
      source: "session",
      payload: {
        approvalId: savedApproval.id,
        permissionRequestId: event.request.id,
        kind: event.request.kind,
        name: event.request.name,
        description: event.request.description,
      },
    })

    await this.tryTransition(runId, "waiting_approval")
  }

  private async handlePermissionResolved(
    runId: string,
    event: Extract<AgentStreamEvent, { type: "permission_resolved" }>,
  ): Promise<void> {
    const approval = await this.findApprovalByPermissionRequestId(runId, event.requestId)
    const decision: ApprovalDecision = event.resolution.allowed ? "approved" : "denied"
    const timestamp = new Date().toISOString()

    if (approval && approval.status === "pending") {
      await this.approvalRepo.update({
        ...approval,
        status: decision,
        resolution: {
          resolved_at: timestamp,
          resolved_by: "runtime_adapter",
          decision,
          note: event.resolution.reason,
        },
        updatedAt: timestamp,
      })
    }

    await this.appendRunEvent({
      runId,
      eventType: "approval.resolved",
      source: "operator",
      payload: {
        approvalId: approval?.id,
        requestId: event.requestId,
        decision,
        allowed: event.resolution.allowed,
        reason: event.resolution.reason,
      },
    })

    if (event.resolution.allowed) {
      await this.tryTransition(runId, "running")
      return
    }

    await this.tryTransition(runId, "failed", {
      failureReason: event.resolution.reason ?? `permission denied: ${event.requestId}`,
    })
  }

  private async findApprovalByPermissionRequestId(
    runId: string,
    requestId: string,
  ): Promise<ApprovalRecord | undefined> {
    const approvals = await this.approvalRepo.listByRunId(runId)

    return approvals.find((approval) => {
      const metadata = approval.metadata as Record<string, unknown> | undefined

      return metadata?.permissionRequestId === requestId
    })
  }

  private async handleAttentionRequired(
    runId: string,
    event: Extract<AgentStreamEvent, { type: "attention_required" }>,
  ): Promise<void> {
    if (event.reason === "finished") {
      await this.appendRunEvent({
        runId,
        eventType: "run.completed",
        source: "session",
        occurredAt: event.timestamp,
        payload: {
          reason: event.reason,
        },
      })

      await this.tryTransition(runId, "succeeded")
      return
    }

    if (event.reason === "error") {
      await this.appendRunEvent({
        runId,
        eventType: "run.failed",
        source: "session",
        occurredAt: event.timestamp,
        payload: {
          reason: event.reason,
          error: event.error,
        },
      })

      await this.tryTransition(runId, "failed", {
        failureReason: event.error ?? "agent attention required: error",
      })
    }
  }

  private async handleTimelineEvent(
    runId: string,
    event: Extract<AgentStreamEvent, { type: "timeline" }>,
  ): Promise<void> {
    const toolCall = extractTimelineToolCall(event.item)

    if (!toolCall) {
      return
    }

    if (toolCall.kind === "declare_phase") {
      await this.appendRunEvent({
        runId,
        eventType: "phase.entered",
        source: "session",
        phase: toolCall.phase,
        payload: {
          phase: toolCall.phase,
        },
      })

      await this.runService.setCurrentPhase(runId, toolCall.phase)
      return
    }

    await this.appendRunEvent({
      runId,
      eventType: "artifact.created",
      source: "session",
      payload: toolCall.artifact,
    })
  }

  private async tryTransition(
    runId: string,
    targetStatus: string,
    metadata?: { failureReason?: string; blockerReason?: string },
  ): Promise<void> {
    try {
      await this.runService.transition(runId, targetStatus as Parameters<RunService["transition"]>[1], metadata)
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith("Invalid run status transition") ||
          error.message.startsWith("required artifact missing"))
      ) {
        return
      }

      throw error
    }
  }

  private async appendRunEvent(input: {
    runId: string
    eventType: string
    source: RunEventEnvelope["source"]
    payload: unknown
    occurredAt?: string
    phase?: string | null
    stageId?: string | null
    sessionId?: string | null
    roleId?: string | null
  }): Promise<RunEventEnvelope> {
    return this.runEventRepo.append({
      id: `evt_${randomUUID()}`,
      runId: input.runId,
      eventType: input.eventType,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      source: input.source,
      phase: input.phase,
      stageId: input.stageId,
      sessionId: input.sessionId,
      roleId: input.roleId,
      payload: input.payload,
    })
  }
}

function mapPermissionKindToActionClass(kind: string): ApprovalRecord["action_class"] {
  switch (kind) {
    case "mcp":
      return "sensitive_mcp_access"
    case "tool":
    case "bash":
    case "network":
    default:
      return "destructive_write"
  }
}

function extractTimelineToolCall(item: AgentTimelineItem): TimelineToolCall | null {
  const name = getTimelineToolName(item)
  const input = getTimelineToolInput(item)

  if (name === "declare_phase" && typeof input.phase === "string" && input.phase.length > 0) {
    return {
      kind: "declare_phase",
      phase: input.phase,
    }
  }

  if (name === "register_artifact") {
    return {
      kind: "register_artifact",
      artifact: input,
    }
  }

  return null
}

function getTimelineToolName(item: AgentTimelineItem): string | null {
  if (typeof item.name === "string") {
    return item.name
  }

  if (typeof item.toolName === "string") {
    return item.toolName
  }

  const tool = item.tool

  if (
    tool &&
    typeof tool === "object" &&
    !Array.isArray(tool) &&
    typeof (tool as Record<string, unknown>).name === "string"
  ) {
    return (tool as Record<string, string>).name
  }

  return null
}

function getTimelineToolInput(item: AgentTimelineItem): Record<string, unknown> {
  for (const candidate of [item.input, item.arguments, item.args, item.params]) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate
    }
  }

  const tool = item.tool

  if (tool && typeof tool === "object" && !Array.isArray(tool)) {
    const toolInput = (tool as Record<string, unknown>).input

    if (toolInput && typeof toolInput === "object" && !Array.isArray(toolInput)) {
      return toolInput as Record<string, unknown>
    }
  }

  return {}
}
