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
  AgentPersistenceHandle,
  AgentStreamEvent,
  AgentTimelineItem,
  ManagedAgent,
} from "../paseo/types.js"
import type { RuntimeAdapterRegistry } from "./run-compiler.js"
import type { RunService } from "./run-service.js"

type TimelineToolCall =
  | { kind: "declare_phase"; phase: string }
  | { kind: "register_artifact"; artifact: Record<string, unknown> }

export class RuntimeAdapter implements RuntimeAdapterRegistry {
  private readonly trackedRunByAgentId = new Map<string, string>()
  private readonly trackedAgentIdByRunId = new Map<string, string>()
  private readonly seenEventKeysByRunId = new Map<string, Set<string>>()
  private readonly processingEventKeysByRunId = new Map<string, Set<string>>()
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
    const previousRunId = this.trackedRunByAgentId.get(agentId)

    if (previousAgentId && previousAgentId !== agentId) {
      this.trackedRunByAgentId.delete(previousAgentId)
    }

    if (previousRunId && previousRunId !== runId) {
      this.trackedAgentIdByRunId.delete(previousRunId)
    }

    this.trackedRunByAgentId.set(agentId, runId)
    this.trackedAgentIdByRunId.set(runId, agentId)
  }

  untrackRun(runId: string): void {
    const agentId = this.trackedAgentIdByRunId.get(runId)

    if (agentId && this.trackedRunByAgentId.get(agentId) === runId) {
      this.trackedRunByAgentId.delete(agentId)
    }

    this.trackedAgentIdByRunId.delete(runId)
    this.seenEventKeysByRunId.delete(runId)
    this.processingEventKeysByRunId.delete(runId)
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
    if (event.type === "agent_state") {
      await this.handleAgentState(event.agent)
      return
    }

    if (event.type !== "agent_stream") {
      return
    }

    const runId = this.trackedRunByAgentId.get(event.agentId)

    if (!runId) {
      return
    }

    const dedupeKey = this.buildDedupeKey(event.agentId, event.seq, event.epoch)
    const processingKeys = this.getProcessingEventKeys(runId)

    if (dedupeKey) {
      if (this.getSeenEventKeys(runId).has(dedupeKey) || processingKeys.has(dedupeKey)) {
        return
      }

      processingKeys.add(dedupeKey)

      if (await this.hasPersistedDedupeKey(runId, dedupeKey)) {
        this.getSeenEventKeys(runId).add(dedupeKey)
        processingKeys.delete(dedupeKey)

        return
      }
    }

    try {
      await this.handleStreamEvent(runId, event.agentId, event.event, dedupeKey)

      if (dedupeKey) {
        this.getSeenEventKeys(runId).add(dedupeKey)
      }
    } finally {
      if (dedupeKey) {
        processingKeys.delete(dedupeKey)
      }
    }
  }

  private async handleAgentState(agent: ManagedAgent): Promise<void> {
    const runId = this.trackedRunByAgentId.get(agent.id)

    if (!runId) {
      return
    }

    await this.upsertRunSession(
      runId,
      agent.id,
      agent.provider,
      agent.persistence,
    )
  }

  private buildDedupeKey(agentId: string, seq?: number, epoch?: string): string | null {
    if (seq == null || epoch == null) {
      return null
    }

    return `${agentId}:${epoch}:${seq}`
  }

  private async hasPersistedDedupeKey(runId: string, dedupeKey: string): Promise<boolean> {
    const events = await this.runEventRepo.listByRunId(runId)

    return events.some((event) => event.correlationId === dedupeKey)
  }

  private getSeenEventKeys(runId: string): Set<string> {
    return getOrCreateSet(this.seenEventKeysByRunId, runId)
  }

  private getProcessingEventKeys(runId: string): Set<string> {
    return getOrCreateSet(this.processingEventKeysByRunId, runId)
  }

  private async handleStreamEvent(
    runId: string,
    agentId: string,
    event: AgentStreamEvent,
    correlationId?: string | null,
  ): Promise<void> {
    switch (event.type) {
      case "thread_started":
        await this.handleThreadStarted(runId, agentId, event, correlationId)
        return
      case "turn_started":
        await this.appendRunEvent({
          runId,
          eventType: "stage.started",
          source: "session",
          correlationId: correlationId ?? undefined,
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
          correlationId: correlationId ?? undefined,
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
        await this.handleTurnFailed(runId, event, correlationId)
        return
      case "turn_canceled":
        return
      case "permission_requested":
        await this.handlePermissionRequested(runId, event, correlationId)
        return
      case "permission_resolved":
        await this.handlePermissionResolved(runId, event, correlationId)
        return
      case "attention_required":
        await this.handleAttentionRequired(runId, event, correlationId)
        return
      case "timeline":
        await this.handleTimelineEvent(runId, event, correlationId)
        return
    }
  }

  private async handleThreadStarted(
    runId: string,
    agentId: string,
    event: Extract<AgentStreamEvent, { type: "thread_started" }>,
    correlationId?: string | null,
  ): Promise<void> {
    await this.upsertRunSession(runId, agentId, event.provider, {
      provider: event.provider,
      sessionId: event.sessionId,
    })

    await this.appendRunEvent({
      runId,
      eventType: "session.created",
      source: "session",
      correlationId: correlationId ?? undefined,
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
    persistence?: AgentPersistenceHandle | null,
  ): Promise<RunSessionRecord> {
    const sessions = await this.runSessionRepo.listByRunId(runId)
    const existing = sessions.find((session) => session.session_id === agentId)
    const timestamp = new Date().toISOString()
    const persistenceHandle = persistence?.sessionId

    if (existing) {
      return this.runSessionRepo.update({
        ...existing,
        provider,
        persistence_handle: persistenceHandle ?? existing.persistence_handle,
        status: "active",
        updatedAt: timestamp,
      })
    }

    return this.runSessionRepo.save({
      kind: "run_session",
      id: `sess_${randomUUID()}`,
      run_id: runId,
      session_id: agentId,
      persistence_handle: persistenceHandle,
      provider,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  private async handleTurnFailed(
    runId: string,
    event: Extract<AgentStreamEvent, { type: "turn_failed" }>,
    correlationId?: string | null,
  ): Promise<void> {
    const isRunFailure = event.severity === "run" || event.severity === "fatal"

    await this.appendRunEvent({
      runId,
      eventType: isRunFailure ? "run.failed" : "stage.failed",
      source: "session",
      correlationId: correlationId ?? undefined,
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
    correlationId?: string | null,
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
      correlationId: correlationId ?? undefined,
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
    correlationId?: string | null,
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
      correlationId: correlationId ?? undefined,
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
    correlationId?: string | null,
  ): Promise<void> {
    if (event.reason === "finished") {
      await this.appendRunEvent({
        runId,
        eventType: "run.completed",
        source: "session",
        correlationId: correlationId ?? undefined,
        occurredAt: event.timestamp,
        payload: {
          reason: event.reason,
        },
      })

      try {
        await this.runService.transition(runId, "succeeded")
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("required artifact missing")) {
          await this.tryTransition(runId, "failed", {
            failureReason: error.message,
          })

          return
        }

        if (error instanceof Error && error.message.startsWith("Invalid run status transition")) {
          return
        }

        throw error
      }

      return
    }

    if (event.reason === "error") {
      await this.appendRunEvent({
        runId,
        eventType: "run.failed",
        source: "session",
        correlationId: correlationId ?? undefined,
        occurredAt: event.timestamp,
        payload: {
          reason: event.reason,
          error: event.error,
        },
      })

      await this.tryTransition(runId, "failed", {
        failureReason: event.error ?? "agent attention required: error",
      })

      return
    }

    if (event.reason === "permission") {
      await this.tryTransition(runId, "waiting_approval")
    }
  }

  private async handleTimelineEvent(
    runId: string,
    event: Extract<AgentStreamEvent, { type: "timeline" }>,
    correlationId?: string | null,
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
        correlationId: correlationId ?? undefined,
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
      correlationId: correlationId ?? undefined,
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
    correlationId?: string
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
      correlationId: input.correlationId,
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
  if (!isSuccessfulTimelineItem(item)) {
    return null
  }

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

function isSuccessfulTimelineItem(item: AgentTimelineItem): boolean {
  if (typeof item.status !== "string") {
    return true
  }

  return ["success", "succeeded", "completed", "ok"].includes(item.status)
}

function getOrCreateSet(store: Map<string, Set<string>>, key: string): Set<string> {
  const existing = store.get(key)

  if (existing) {
    return existing
  }

  const created = new Set<string>()
  store.set(key, created)

  return created
}
