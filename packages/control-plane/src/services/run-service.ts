import crypto from "node:crypto"

import type {
  PolicySnapshot,
  RunEventEnvelope,
  RunPlan,
  RunStatus,
} from "@pluto-agent-platform/contracts"

import type {
  HarnessRepository,
  PlaybookRepository,
  PolicySnapshotRepository,
  RunEventRepository,
  RunPlanRepository,
  RunRecord,
  RunRepository,
} from "../repositories.js"
import { transition as transitionRunStatus } from "./run-state-machine.js"

export interface ArtifactRequirementChecker {
  checkRequiredArtifacts(runId: string): Promise<{ missingTypes: string[] }>
}

export interface RunTransitionMetadata {
  failureReason?: string
  blockerReason?: string
}

export interface ProjectedRunState {
  status?: RunStatus
  currentPhase?: string
  completedPhases: string[]
  approvals: {
    pending: string[]
    resolved: string[]
  }
}

const buildRunPlan = (runId: string, phases: string[]): RunPlan => ({
  kind: "run_plan",
  run_id: runId,
  current_phase: phases[0],
  stages: phases.map((phase, index) => ({
    id: `stage_${index + 1}_${phase}`,
    phase,
    status: "pending",
  })),
})

const buildPolicySnapshot = (
  runId: string,
  harness: {
    approvals?: PolicySnapshot["approvals"]
    timeouts?: PolicySnapshot["timeouts"]
    requirements?: PolicySnapshot["requirements"]
  },
): PolicySnapshot => ({
  kind: "policy_snapshot",
  run_id: runId,
  approvals: harness.approvals,
  timeouts: harness.timeouts,
  requirements: harness.requirements,
})

const createRunEvent = (
  runId: string,
  eventType: string,
  payload: Record<string, unknown>,
  occurredAt: string,
): RunEventEnvelope => ({
  id: `evt_${crypto.randomUUID()}`,
  runId,
  eventType,
  occurredAt,
  source: "system",
  payload,
})

const getPayloadValue = <T>(
  event: RunEventEnvelope,
  key: string,
): T | undefined => {
  if (event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)) {
    return (event.payload as Record<string, T | undefined>)[key]
  }

  return undefined
}

export class RunService {
  constructor(
    private readonly playbookRepository: PlaybookRepository,
    private readonly harnessRepository: HarnessRepository,
    private readonly runRepository: RunRepository,
    private readonly runEventRepository: RunEventRepository,
    private readonly runPlanRepository: RunPlanRepository,
    private readonly policySnapshotRepository: PolicySnapshotRepository,
    private readonly artifactRequirementChecker: ArtifactRequirementChecker,
  ) {}

  async create(
    playbookId: string,
    harnessId: string,
    inputs: Record<string, unknown>,
  ): Promise<RunRecord> {
    const [playbook, harness] = await Promise.all([
      this.playbookRepository.getById(playbookId),
      this.harnessRepository.getById(harnessId),
    ])

    if (!playbook) {
      throw new Error(`Playbook not found: ${playbookId}`)
    }

    if (!harness) {
      throw new Error(`Harness not found: ${harnessId}`)
    }

    const timestamp = new Date().toISOString()
    const runId = `run_${crypto.randomUUID()}`

    const run: RunRecord = {
      kind: "run",
      id: runId,
      playbook: playbook.id,
      harness: harness.id,
      input: structuredClone(inputs),
      status: "queued",
      current_phase: harness.phases[0],
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const runPlan = buildRunPlan(runId, harness.phases)
    const policySnapshot = buildPolicySnapshot(runId, harness)

    const savedRun = await this.runRepository.save(run)

    await Promise.all([
      this.runPlanRepository.save(runPlan),
      this.policySnapshotRepository.save(policySnapshot),
      this.runEventRepository.append(
        createRunEvent(
          runId,
          "run.created",
          {
            status: savedRun.status,
            playbookId: savedRun.playbook,
            harnessId: savedRun.harness,
          },
          timestamp,
        ),
      ),
    ])

    return savedRun
  }

  async transition(
    runId: string,
    targetStatus: RunStatus,
    metadata: RunTransitionMetadata = {},
  ): Promise<RunRecord> {
    const run = await this.runRepository.getById(runId)

    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }

    transitionRunStatus(run.status, targetStatus)

    if (targetStatus === "failed" && !metadata.failureReason) {
      throw new Error("failureReason is required when transitioning a run to failed")
    }

    if (targetStatus === "blocked" && !metadata.blockerReason) {
      throw new Error("blockerReason is required when transitioning a run to blocked")
    }

    if (targetStatus === "succeeded") {
      const { missingTypes } = await this.artifactRequirementChecker.checkRequiredArtifacts(runId)

      if (missingTypes.length > 0) {
        throw new Error(`required artifact missing: ${missingTypes[0]}`)
      }
    }

    const timestamp = new Date().toISOString()
    const updatedRun: RunRecord = {
      ...run,
      status: targetStatus,
      blockerReason: targetStatus === "blocked" ? metadata.blockerReason : undefined,
      failureReason:
        targetStatus === "failed"
          ? metadata.failureReason
          : targetStatus === "running"
            ? undefined
            : run.failureReason,
      updatedAt: timestamp,
    }

    const savedRun = await this.runRepository.update(updatedRun)

    await this.runEventRepository.append(
      createRunEvent(
        runId,
        "run.status_changed",
        {
          fromStatus: run.status,
          toStatus: targetStatus,
          failureReason: metadata.failureReason,
          blockerReason: metadata.blockerReason,
        },
        timestamp,
      ),
    )

    return savedRun
  }

  async setCurrentPhase(runId: string, currentPhase?: string): Promise<RunRecord> {
    const run = await this.runRepository.getById(runId)

    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }

    const updatedRun: RunRecord = {
      ...run,
      current_phase: currentPhase,
      updatedAt: new Date().toISOString(),
    }

    return this.runRepository.update(updatedRun)
  }
}

export const projectRunStateFromEvents = (
  events: RunEventEnvelope[],
): ProjectedRunState => {
  const sortedEvents = [...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
  const completedPhases = new Set<string>()
  const pendingApprovals = new Set<string>()
  const resolvedApprovals = new Set<string>()

  let status: RunStatus | undefined
  let currentPhase: string | undefined

  for (const event of sortedEvents) {
    switch (event.eventType) {
      case "run.created":
        status = "queued"
        break
      case "run.initialized":
        status = "initializing"
        break
      case "run.started":
        status = "running"
        break
      case "run.failed":
        status = "failed"
        break
      case "run.succeeded":
        status = "succeeded"
        break
      case "run.canceled":
        status = "canceled"
        break
      case "run.archived":
        status = "archived"
        break
      case "run.status_changed": {
        const toStatus = getPayloadValue<RunStatus>(event, "toStatus")

        if (toStatus) {
          status = toStatus
        }

        break
      }
      case "phase.entered":
        currentPhase = event.phase ?? undefined
        break
      case "phase.exited":
        if (event.phase) {
          completedPhases.add(event.phase)
        }

        if (currentPhase === event.phase) {
          currentPhase = undefined
        }
        break
      case "approval.requested": {
        const approvalId = getPayloadValue<string>(event, "approvalId")

        if (approvalId) {
          pendingApprovals.add(approvalId)
          resolvedApprovals.delete(approvalId)
        }

        break
      }
      case "approval.resolved": {
        const approvalId = getPayloadValue<string>(event, "approvalId")

        if (approvalId) {
          pendingApprovals.delete(approvalId)
          resolvedApprovals.add(approvalId)
        }

        break
      }
    }
  }

  return {
    status,
    currentPhase,
    completedPhases: [...completedPhases],
    approvals: {
      pending: [...pendingApprovals],
      resolved: [...resolvedApprovals],
    },
  }
}
