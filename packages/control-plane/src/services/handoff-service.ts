/**
 * Handoff Service — Plan 004 Feature 4
 *
 * Manages the lifecycle of handoffs between team roles in a supervisor-led run.
 * Records durable handoff events and mutates the RunPlan on accepted handoffs.
 */
import { randomUUID } from "node:crypto"
import type { RunEventEnvelope, RunPlan } from "@pluto-agent-platform/contracts"
import type {
  RunRecord,
  RunRepository,
  RunEventRepository,
  RunPlanRepository,
  RunSessionRecord,
  RunSessionRepository,
  RoleSpecRecord,
  RoleSpecRepository,
  TeamSpecRecord,
  TeamSpecRepository,
} from "../repositories.js"
import type { AgentManager, AgentSessionConfig } from "../paseo/types.js"
import type { RuntimeAdapterRegistry } from "./run-compiler.js"

export interface HandoffRequest {
  runId: string
  fromRole: string
  toRole: string
  summary: string
  context?: string
  stageId?: string
}

export interface HandoffRecord {
  id: string
  runId: string
  fromRole: string
  toRole: string
  summary: string
  context?: string
  stageId?: string
  status: "pending" | "accepted" | "rejected"
  createdAt: string
  resolvedAt?: string
  rejectionReason?: string
}

export interface HandoffResult {
  handoff: HandoffRecord
  workerSession?: RunSessionRecord
}

export interface HandoffServiceDeps {
  runRepository: RunRepository
  runEventRepository: RunEventRepository
  runPlanRepository: RunPlanRepository
  runSessionRepository: RunSessionRepository
  roleSpecRepository: RoleSpecRepository
  teamSpecRepository: TeamSpecRepository
  agentManager: AgentManager
  runtimeAdapter: RuntimeAdapterRegistry
}

export class HandoffService {
  private readonly handoffs = new Map<string, HandoffRecord>()

  constructor(private readonly deps: HandoffServiceDeps) {}

  async createHandoff(request: HandoffRequest): Promise<HandoffResult> {
    // Validate the run exists and has a team
    const run = await this.deps.runRepository.getById(request.runId)
    if (!run) throw new Error(`Run not found: ${request.runId}`)
    if (!run.team) throw new Error(`Run ${request.runId} is not a team run`)

    // Validate the target role exists in the team
    const team = await this.deps.teamSpecRepository.getById(run.team)
    if (!team) throw new Error(`TeamSpec not found: ${run.team}`)

    if (!team.roles.includes(request.toRole)) {
      throw new Error(`Role ${request.toRole} is not a member of team ${team.id}`)
    }

    // Validate the target role spec exists
    const targetRole = await this.deps.roleSpecRepository.getById(request.toRole)
    if (!targetRole) throw new Error(`RoleSpec not found: ${request.toRole}`)

    const timestamp = new Date().toISOString()
    const handoffId = `hoff_${randomUUID()}`

    // Create the handoff record
    const handoff: HandoffRecord = {
      id: handoffId,
      runId: request.runId,
      fromRole: request.fromRole,
      toRole: request.toRole,
      summary: request.summary,
      context: request.context,
      stageId: request.stageId,
      status: "pending",
      createdAt: timestamp,
    }

    this.handoffs.set(handoffId, handoff)

    // Record handoff.created event
    await this.deps.runEventRepository.append(
      buildHandoffEvent(request.runId, "handoff.created", {
        handoffId,
        fromRole: request.fromRole,
        toRole: request.toRole,
        summary: request.summary,
      }, timestamp),
    )

    // Auto-accept in Phase 2 (supervisor-led: lead delegates, worker accepts)
    const result = await this.acceptHandoff(handoffId, run, team, targetRole)
    return result
  }

  async rejectHandoff(handoffId: string, reason: string): Promise<HandoffRecord> {
    const handoff = this.handoffs.get(handoffId)
    if (!handoff) throw new Error(`Handoff not found: ${handoffId}`)
    if (handoff.status !== "pending") {
      throw new Error(`Handoff ${handoffId} is already ${handoff.status}`)
    }

    const timestamp = new Date().toISOString()
    handoff.status = "rejected"
    handoff.resolvedAt = timestamp
    handoff.rejectionReason = reason

    // Record handoff.rejected event
    await this.deps.runEventRepository.append(
      buildHandoffEvent(handoff.runId, "handoff.rejected", {
        handoffId,
        fromRole: handoff.fromRole,
        toRole: handoff.toRole,
        reason,
      }, timestamp),
    )

    return { ...handoff }
  }

  getHandoff(handoffId: string): HandoffRecord | undefined {
    const handoff = this.handoffs.get(handoffId)
    return handoff ? { ...handoff } : undefined
  }

  listByRunId(runId: string): HandoffRecord[] {
    return Array.from(this.handoffs.values())
      .filter((h) => h.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((h) => ({ ...h }))
  }

  private async acceptHandoff(
    handoffId: string,
    run: RunRecord,
    team: TeamSpecRecord,
    targetRole: RoleSpecRecord,
  ): Promise<HandoffResult> {
    const handoff = this.handoffs.get(handoffId)!
    const timestamp = new Date().toISOString()

    handoff.status = "accepted"
    handoff.resolvedAt = timestamp

    // Record handoff.accepted event
    await this.deps.runEventRepository.append(
      buildHandoffEvent(run.id, "handoff.accepted", {
        handoffId,
        fromRole: handoff.fromRole,
        toRole: handoff.toRole,
      }, timestamp),
    )

    // Mutate RunPlan: add a delegated stage for the worker role
    const plan = await this.deps.runPlanRepository.getByRunId(run.id)
    if (plan) {
      const delegatedStageId = `stage_handoff_${targetRole.id}_${randomUUID().slice(0, 8)}`
      const currentPhase = plan.current_phase ?? plan.stages[0]?.phase ?? "unknown"
      const updatedPlan: RunPlan = {
        ...plan,
        stages: [
          ...plan.stages,
          {
            id: delegatedStageId,
            phase: currentPhase,
            role: targetRole.id,
            status: "running",
          },
        ],
      }
      await this.deps.runPlanRepository.save(updatedPlan)
    }

    // Spawn a worker session for the target role
    const workerSession = await this.spawnWorkerSession(run, team, targetRole, handoff)

    return { handoff: { ...handoff }, workerSession }
  }

  private async spawnWorkerSession(
    run: RunRecord,
    _team: TeamSpecRecord,
    role: RoleSpecRecord,
    handoff: HandoffRecord,
  ): Promise<RunSessionRecord> {
    const systemPrompt = buildWorkerSystemPrompt(role, handoff)

    const agentConfig: AgentSessionConfig = {
      provider: "claude",
      cwd: process.cwd(),
      systemPrompt,
      title: `Run: ${run.id} [${role.name}]`,
      mcpServers: {},
    }

    const agent = await this.deps.agentManager.createAgent(agentConfig)
    const persistenceHandle = this.deps.agentManager.getAgent?.(agent.id)?.persistence?.sessionId
      ?? agent.persistence?.sessionId

    // Track the agent
    this.deps.runtimeAdapter.trackRun(run.id, agent.id)

    // Create RunSession for the worker
    const timestamp = new Date().toISOString()
    const sessionRecord: RunSessionRecord = {
      kind: "run_session",
      id: `sess_${randomUUID()}`,
      run_id: run.id,
      session_id: agent.id,
      persistence_handle: persistenceHandle,
      role_id: role.id,
      provider: agentConfig.provider,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await this.deps.runSessionRepository.save(sessionRecord)

    // Start the worker with the handoff context
    const initialPrompt = buildWorkerInitialPrompt(handoff)
    this.deps.agentManager
      .runAgent(agent.id, initialPrompt)
      .catch(() => {
        // Errors handled by runtime adapter
      })

    // Record session.created event
    await this.deps.runEventRepository.append(
      buildHandoffEvent(run.id, "session.created", {
        sessionId: sessionRecord.id,
        roleId: role.id,
        handoffId: handoff.id,
      }, timestamp),
    )

    return sessionRecord
  }
}

function buildHandoffEvent(
  runId: string,
  eventType: string,
  payload: Record<string, unknown>,
  occurredAt: string,
): RunEventEnvelope {
  return {
    id: `evt_${randomUUID()}`,
    runId,
    eventType,
    occurredAt,
    source: "orchestrator",
    payload,
  }
}

function buildWorkerSystemPrompt(
  role: RoleSpecRecord,
  handoff: HandoffRecord,
): string {
  const sections: string[] = []
  sections.push(`# Role: ${role.name}`)
  sections.push(`## Responsibility\n${role.description}`)

  if (role.system_prompt) {
    sections.push(`## Instructions\n${role.system_prompt}`)
  }

  sections.push(`## Assignment\nYou have been delegated work via handoff from role \`${handoff.fromRole}\`.`)
  sections.push(`### Summary\n${handoff.summary}`)

  if (handoff.context) {
    sections.push(`### Context\n${handoff.context}`)
  }

  sections.push(`## Available Control-Plane MCP Tools`)
  sections.push(`### register_artifact\nRegisters a deliverable produced during execution.\nParameters: { "runId": "${handoff.runId}", "type": "<artifact_type>", "title": "<title>", "format": "<format>" }`)

  return sections.join("\n\n")
}

function buildWorkerInitialPrompt(handoff: HandoffRecord): string {
  return `You have been assigned work by the lead agent (role: ${handoff.fromRole}).\n\nTask: ${handoff.summary}${handoff.context ? `\n\nContext: ${handoff.context}` : ""}\n\nComplete this work and register any artifacts produced.`
}
