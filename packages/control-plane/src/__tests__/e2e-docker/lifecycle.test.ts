import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { projectRunStateFromEvents } from "../../services/run-service.js"
import {
  closeE2EDockerTestContext,
  getE2EDockerTestContext,
  resetE2EDockerDatabase,
  type E2EDockerTestContext,
} from "./setup.js"

const describeDocker = process.env.DATABASE_URL ? describe : describe.skip

let context: E2EDockerTestContext

async function createStartedRun(options?: {
  playbookArtifacts?: Array<{ type: string; format?: string }>
  harnessPhases?: string[]
  approvals?: Record<string, "required" | "optional" | "disabled" | "inherit">
}) {
  const playbook = await context.playbookService.create({
    name: "Docker E2E Playbook",
    description: "Exercises the Postgres-backed control-plane lifecycle",
    goal: "Verify the control plane works against a real Postgres database",
    instructions: "Execute the lifecycle and persist all control-plane records.",
    artifacts: options?.playbookArtifacts,
  })

  const harness = await context.harnessService.create({
    name: "Docker E2E Harness",
    description: "Simple harness for Docker-backed E2E verification",
    phases: options?.harnessPhases ?? ["work", "review"],
    approvals: options?.approvals,
  })

  await context.harnessService.attachToPlaybook(harness.id, playbook.id)

  const run = await context.compiler.compile({
    playbookId: playbook.id,
    harnessId: harness.id,
    inputs: {
      topic: "docker-e2e",
      attempt: 1,
    },
    provider: "claude",
  })

  return { playbook, harness, run }
}

describeDocker("Docker E2E: Postgres-backed lifecycle", () => {
  beforeAll(() => {
    context = getE2EDockerTestContext()
  })

  beforeEach(async () => {
    await resetE2EDockerDatabase()
  })

  afterAll(async () => {
    await closeE2EDockerTestContext()
  })

  it("creates a playbook and harness, starts a run, and persists core records", async () => {
    const { playbook, harness, run } = await createStartedRun({
      playbookArtifacts: [{ type: "run_report", format: "json" }],
      approvals: { destructive_write: "required" },
    })

    expect(run.status).toBe("running")
    expect(run.current_phase).toBe("work")

    const persistedRun = await context.runRepo.getById(run.id)
    const persistedPlan = await context.runPlanRepo.getByRunId(run.id)
    const persistedPolicySnapshot = await context.policySnapshotRepo.getByRunId(run.id)
    const persistedSessions = await context.runSessionRepo.listByRunId(run.id)

    expect(persistedRun).not.toBeNull()
    expect(persistedRun?.playbook).toBe(playbook.id)
    expect(persistedRun?.harness).toBe(harness.id)
    expect(persistedRun?.input).toEqual({ topic: "docker-e2e", attempt: 1 })
    expect(persistedPlan?.current_phase).toBe("work")
    expect(persistedPlan?.stages.map((stage) => stage.phase)).toEqual(["work", "review"])
    expect(persistedPolicySnapshot?.approvals).toEqual({ destructive_write: "required" })
    expect(persistedSessions).toHaveLength(1)
    expect(context.agentManager.listAgents()).toHaveLength(1)
  })

  it("creates and resolves approvals through Postgres repositories", async () => {
    const { run } = await createStartedRun()

    const approval = await context.approvalService.createApproval({
      runId: run.id,
      actionClass: "destructive_write",
      title: "Approve production write",
      requestedBy: {
        source: "session",
        role_id: "lead",
        session_id: "session_lead_1",
      },
      context: {
        phase: "review",
        reason: "Requires operator approval before applying the change.",
      },
    })

    const pendingApproval = await context.approvalRepo.getById(approval.id)
    const waitingRun = await context.runRepo.getById(run.id)

    expect(pendingApproval?.status).toBe("pending")
    expect(waitingRun?.status).toBe("waiting_approval")

    const resolvedApproval = await context.approvalService.resolve(
      approval.id,
      "approved",
      "operator_1",
      "Approved in Docker E2E test",
    )

    const persistedApproval = await context.approvalRepo.getById(approval.id)
    const resumedRun = await context.runRepo.getById(run.id)

    expect(resolvedApproval.status).toBe("approved")
    expect(persistedApproval?.resolution?.decision).toBe("approved")
    expect(persistedApproval?.resolution?.resolved_by).toBe("operator_1")
    expect(resumedRun?.status).toBe("running")
  })

  it("registers artifacts and round-trips them through Postgres", async () => {
    const { run } = await createStartedRun({
      playbookArtifacts: [{ type: "run_report", format: "json" }],
    })

    const missingBefore = await context.artifactService.checkRequiredArtifacts(run.id)
    expect(missingBefore.missingTypes).toEqual(["run_report"])

    const artifact = await context.artifactService.register({
      runId: run.id,
      type: "run_report",
      title: "Run report",
      format: "json",
      producer: {
        role_id: "lead",
        session_id: "session_lead_1",
      },
    })

    const persistedArtifact = await context.artifactRepo.getById(artifact.id)
    const artifactsByRun = await context.artifactRepo.listByRunId(run.id)
    const missingAfter = await context.artifactService.checkRequiredArtifacts(run.id)

    expect(persistedArtifact?.type).toBe("run_report")
    expect(persistedArtifact?.format).toBe("json")
    expect(persistedArtifact?.producer).toEqual({
      role_id: "lead",
      session_id: "session_lead_1",
    })
    expect(artifactsByRun).toHaveLength(1)
    expect(missingAfter.missingTypes).toHaveLength(0)
  })

  it("persists run events durably and lets them be queried back", async () => {
    const { run } = await createStartedRun({
      playbookArtifacts: [{ type: "run_report", format: "json" }],
      approvals: { destructive_write: "required" },
    })

    const unsubscribe = context.runtimeAdapter.start()

    try {
      const [session] = await context.runSessionRepo.listByRunId(run.id)
      expect(session).toBeDefined()

      context.phaseController.registerRunAgent(run.id, session.session_id)

      context.agentManager.emit(
        session.session_id,
        {
          type: "thread_started",
          provider: "claude",
          sessionId: `runtime_${run.id}`,
        },
        1,
        "epoch_1",
      )
      context.agentManager.emit(
        session.session_id,
        {
          type: "turn_started",
          provider: "claude",
          phase: "work",
        },
        2,
        "epoch_1",
      )
      context.agentManager.emit(
        session.session_id,
        {
          type: "turn_completed",
          provider: "claude",
          phase: "work",
        },
        3,
        "epoch_1",
      )

      await new Promise((resolve) => setTimeout(resolve, 25))

      const phaseResult = await context.phaseController.handlePhaseDeclaration(run.id, "review")
      expect(phaseResult.allowed).toBe(true)

      const [pendingApproval] = await context.approvalRepo.listByRunId(run.id)
      expect(pendingApproval?.status).toBe("pending")

      await context.phaseController.handleApprovalResolution(run.id, pendingApproval.id, "approved")
      await context.approvalService.resolve(
        pendingApproval.id,
        "approved",
        "operator_1",
        "Approval granted for review phase",
      )

      await context.artifactService.register({
        runId: run.id,
        type: "run_report",
        title: "Lifecycle report",
        format: "json",
      })

      await context.runService.transition(run.id, "succeeded")

      const events = await context.runEventRepo.listByRunId(run.id)
      const eventTypes = events.map((event) => event.eventType)
      const projectedState = projectRunStateFromEvents(events)
      const reviewPhaseEvent = events.find((event) => event.eventType === "phase.entered")

      expect(eventTypes).toEqual(
        expect.arrayContaining([
          "run.created",
          "run.status_changed",
          "session.created",
          "stage.started",
          "stage.completed",
          "phase.entered",
          "approval.requested",
          "approval.resolved",
          "artifact.registered",
        ]),
      )
      expect(reviewPhaseEvent?.payload).toEqual({ phase: "review" })
      expect(projectedState.status).toBe("succeeded")
      expect(projectedState.approvals.pending).toHaveLength(0)
      expect(projectedState.approvals.resolved).toContain(pendingApproval.id)
      expect(
        context.agentManager.runAgentCalls.some(({ prompt }) => {
          const value = typeof prompt === "string" ? prompt : ""
          return value.includes("Approval granted")
        }),
      ).toBe(true)
    } finally {
      unsubscribe()
      context.phaseController.cleanup(run.id)
    }
  })
})
