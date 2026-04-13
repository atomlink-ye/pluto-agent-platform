/**
 * Phase Controller — Plan 003 Feature 4
 *
 * Enforces harness governance during live runs:
 * - Phase ordering validation
 * - Approval gate detection and creation
 * - Required artifact check at completion
 * - Timeout enforcement
 */
import { randomUUID } from "node:crypto"
import type { RunEventEnvelope } from "@pluto-agent-platform/contracts"
import type {
  HarnessRecord,
  RunRecord,
  ApprovalRecord,
  HarnessRepository,
  RunRepository,
  RunEventRepository,
  ApprovalRepository,
} from "../repositories.js"
import type { RunService, ArtifactRequirementChecker } from "./run-service.js"
import type {
  AgentManager,
  AgentPromptInput,
} from "../paseo/types.js"

export interface PhaseControllerDeps {
  harnessRepository: HarnessRepository
  runRepository: RunRepository
  runEventRepository: RunEventRepository
  approvalRepository: ApprovalRepository
  runService: RunService
  artifactChecker: ArtifactRequirementChecker
  agentManager: AgentManager
}

export interface PhaseTransitionResult {
  allowed: boolean
  error?: string
}

export class PhaseController {
  /** Active timeout timers keyed by runId */
  private timeoutTimers = new Map<string, NodeJS.Timeout>()
  /** Maps runId → agentId for sending continuation prompts */
  private runAgentMap = new Map<string, string>()

  constructor(private readonly deps: PhaseControllerDeps) {}

  registerRunAgent(runId: string, agentId: string): void {
    this.runAgentMap.set(runId, agentId)
  }

  /**
   * Validate and enforce a phase transition declared by the lead agent.
   */
  async handlePhaseDeclaration(
    runId: string,
    targetPhase: string,
  ): Promise<PhaseTransitionResult> {
    const run = await this.deps.runRepository.getById(runId)
    if (!run) return { allowed: false, error: `Run not found: ${runId}` }

    const harness = await this.deps.harnessRepository.getById(run.harness)
    if (!harness) return { allowed: false, error: `Harness not found: ${run.harness}` }

    // Validate phase ordering
    const orderError = validatePhaseOrder(harness, run.current_phase, targetPhase)
    if (orderError) {
      await this.appendRunEvent(runId, "phase.rejected", {
        targetPhase,
        currentPhase: run.current_phase,
        reason: orderError,
      })
      return { allowed: false, error: orderError }
    }

    // Update the run's current phase
    run.current_phase = targetPhase
    run.updatedAt = new Date().toISOString()
    await this.deps.runRepository.update(run)

    await this.appendRunEvent(runId, "phase.entered", { phase: targetPhase })

    // Check for approval gates on this phase
    await this.checkApprovalGate(run, harness, targetPhase)

    // Start timeout monitoring for this phase
    this.startPhaseTimeout(runId, harness, targetPhase)

    return { allowed: true }
  }

  /**
   * Handle approval resolution — resume the Paseo agent.
   */
  async handleApprovalResolution(
    runId: string,
    approvalId: string,
    decision: "approved" | "denied",
  ): Promise<void> {
    if (decision === "approved") {
      const run = await this.deps.runRepository.getById(runId)
      if (!run) return

      // Send continuation prompt to agent
      const agentId = this.runAgentMap.get(runId)
      if (agentId) {
        const phase = run.current_phase ?? "unknown"
        await this.deps.agentManager.runAgent(
          agentId,
          `Approval granted for ${phase} phase. Proceed with execution.`,
        )
      }
    }
  }

  /**
   * Check completion requirements before allowing run to succeed.
   */
  async handleCompletionCheck(runId: string): Promise<{ allowed: boolean; error?: string }> {
    const { missingTypes } = await this.deps.artifactChecker.checkRequiredArtifacts(runId)
    if (missingTypes.length > 0) {
      return {
        allowed: false,
        error: `required artifact missing: ${missingTypes.join(", ")}`,
      }
    }
    return { allowed: true }
  }

  /**
   * Clean up timers when a run terminates.
   */
  cleanup(runId: string): void {
    const timer = this.timeoutTimers.get(runId)
    if (timer) {
      clearTimeout(timer)
      this.timeoutTimers.delete(runId)
    }
    this.runAgentMap.delete(runId)
  }

  private async checkApprovalGate(
    run: RunRecord,
    harness: HarnessRecord,
    phase: string,
  ): Promise<void> {
    if (!harness.approvals) return

    // Check if any approval rules apply to this phase
    const hasApprovalGate = Object.entries(harness.approvals).some(
      ([, value]) => value === "required",
    )

    // For now, check if the phase has explicit approval requirements
    // In a full implementation, this would map phase → approval action classes
    if (hasApprovalGate && isGatedPhase(harness, phase)) {
      // Create ApprovalTask
      const approval: ApprovalRecord = {
        kind: "approval",
        id: `appr_${randomUUID()}`,
        run_id: run.id,
        action_class: "destructive_write",
        title: `Phase approval required: ${phase}`,
        status: "pending",
        requested_by: { source: "system" },
        context: { phase, reason: `Harness requires approval before ${phase}` },
        resolution: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      await this.deps.approvalRepository.save(approval)

      await this.appendRunEvent(run.id, "approval.requested", {
        approvalId: approval.id,
        phase,
        reason: `Harness requires approval for ${phase} phase`,
      })

      // Transition run to waiting_approval
      await this.deps.runService.transition(run.id, "waiting_approval")

      // Inform the agent
      const agentId = this.runAgentMap.get(run.id)
      if (agentId) {
        await this.deps.agentManager.runAgent(
          agentId,
          `Awaiting approval before proceeding with ${phase} phase. Please wait.`,
        )
      }
    }
  }

  private startPhaseTimeout(
    runId: string,
    harness: HarnessRecord,
    phase: string,
  ): void {
    // Clear existing timer
    const existing = this.timeoutTimers.get(runId)
    if (existing) clearTimeout(existing)

    const timeoutMinutes = harness.timeouts?.per_phase?.[phase]
    if (!timeoutMinutes) return

    const timer = setTimeout(async () => {
      try {
        await this.appendRunEvent(runId, "phase.timeout", {
          phase,
          timeoutMinutes,
        })
        await this.deps.runService.transition(runId, "blocked", {
          blockerReason: `phase '${phase}' exceeded timeout (${timeoutMinutes} minutes)`,
        })
      } catch {
        // Run may already be terminal
      }
    }, timeoutMinutes * 60 * 1000)

    this.timeoutTimers.set(runId, timer)
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
      source: "system",
      payload,
    }
    return this.deps.runEventRepository.append(event)
  }
}

function validatePhaseOrder(
  harness: HarnessRecord,
  currentPhase: string | undefined,
  targetPhase: string,
): string | null {
  const phases = harness.phases
  const targetIdx = phases.indexOf(targetPhase)

  if (targetIdx === -1) {
    return `Unknown phase: '${targetPhase}'. Valid phases: ${phases.join(", ")}`
  }

  if (!currentPhase) {
    // First phase must be the first in the list
    if (targetIdx !== 0) {
      return `cannot enter '${targetPhase}' — must start with '${phases[0]}'`
    }
    return null
  }

  const currentIdx = phases.indexOf(currentPhase)
  if (currentIdx === -1) {
    return null // Current phase is unknown, allow transition
  }

  if (targetIdx <= currentIdx) {
    return `cannot enter '${targetPhase}' — already at or past this phase (current: '${currentPhase}')`
  }

  if (targetIdx > currentIdx + 1) {
    const skipped = phases[currentIdx + 1]
    return `cannot enter '${targetPhase}' before completing '${skipped}'`
  }

  return null
}

function isGatedPhase(harness: HarnessRecord, phase: string): boolean {
  // Convention: the last phase with approval rules is gated
  // In a full implementation, this would check phase-specific approval rules
  const phases = harness.phases
  const phaseIdx = phases.indexOf(phase)
  return phaseIdx === phases.length - 1 && Object.keys(harness.approvals ?? {}).length > 0
}
