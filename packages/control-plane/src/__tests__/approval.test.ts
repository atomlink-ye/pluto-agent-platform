import { describe, expect, it } from "vitest"

import {
  ApprovalService,
  ArtifactService,
  HarnessService,
  InMemoryApprovalRepository,
  InMemoryArtifactRepository,
  InMemoryHarnessRepository,
  InMemoryPlaybookRepository,
  InMemoryPolicySnapshotRepository,
  InMemoryRunEventRepository,
  InMemoryRunPlanRepository,
  InMemoryRunRepository,
  PlaybookService,
  RunService,
} from "../index.js"

const createApprovalServices = () => {
  const approvalRepository = new InMemoryApprovalRepository()
  const artifactRepository = new InMemoryArtifactRepository()
  const harnessRepository = new InMemoryHarnessRepository()
  const playbookRepository = new InMemoryPlaybookRepository()
  const policySnapshotRepository = new InMemoryPolicySnapshotRepository()
  const runEventRepository = new InMemoryRunEventRepository()
  const runPlanRepository = new InMemoryRunPlanRepository()
  const runRepository = new InMemoryRunRepository()

  const playbookService = new PlaybookService(playbookRepository)
  const harnessService = new HarnessService(harnessRepository, playbookRepository)
  const artifactService = new ArtifactService(
    artifactRepository,
    runRepository,
    playbookRepository,
    runEventRepository,
  )
  const runService = new RunService(
    playbookRepository,
    harnessRepository,
    runRepository,
    runEventRepository,
    runPlanRepository,
    policySnapshotRepository,
    artifactService,
  )
  const approvalService = new ApprovalService(approvalRepository, runService, runEventRepository)

  return {
    approvalRepository,
    approvalService,
    harnessService,
    playbookService,
    runEventRepository,
    runRepository,
    runService,
  }
}

const createRunningRun = async () => {
  const services = createApprovalServices()
  const playbook = await services.playbookService.create({
    name: "approval-playbook",
    description: "Playbook that needs approval",
    goal: "Produce a governed change",
    instructions: "Do the work and request approval before publish",
  })
  const harness = await services.harnessService.create({
    name: "approval-harness",
    description: "Harness with approvals",
    phases: ["collect", "review"],
  })

  await services.harnessService.attachToPlaybook(harness.id, playbook.id)

  const run = await services.runService.create(playbook.id, harness.id, { task: "publish" })

  await services.runService.transition(run.id, "initializing")
  await services.runService.transition(run.id, "running")

  return {
    ...services,
    run,
  }
}

describe("ApprovalService", () => {
  it("scenario 4.1: creates a durable approval and pauses the run", async () => {
    const { approvalService, run, runRepository } = await createRunningRun()

    const approval = await approvalService.createApproval({
      runId: run.id,
      actionClass: "pr_creation",
      title: "Approve PR creation",
      requestedBy: {
        source: "policy",
        role_id: "reviewer",
      },
      context: {
        phase: "review",
        reason: "Protected action requires approval",
      },
    })

    const updatedRun = await runRepository.getById(run.id)

    expect(approval.status).toBe("pending")
    expect(updatedRun?.status).toBe("waiting_approval")
  })

  it("scenario 4.2: approving resolves the approval and resumes the run", async () => {
    const { approvalService, run, runEventRepository, runRepository } = await createRunningRun()
    const approval = await approvalService.createApproval({
      runId: run.id,
      actionClass: "pr_creation",
      title: "Approve PR creation",
      requestedBy: {
        source: "policy",
      },
    })

    const resolvedApproval = await approvalService.resolve(approval.id, "approved", "operator_001")
    const updatedRun = await runRepository.getById(run.id)
    const events = await runEventRepository.listByRunId(run.id)

    expect(resolvedApproval.status).toBe("approved")
    expect(resolvedApproval.resolution).toEqual(
      expect.objectContaining({
        resolved_by: "operator_001",
        decision: "approved",
      }),
    )
    expect(updatedRun?.status).toBe("running")
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "approval.resolved",
          payload: expect.objectContaining({
            approvalId: approval.id,
            decision: "approved",
          }),
        }),
      ]),
    )
  })

  it("scenario 4.3: denying fails the run with a durable reason", async () => {
    const { approvalService, run, runRepository } = await createRunningRun()
    const approval = await approvalService.createApproval({
      runId: run.id,
      actionClass: "production_change",
      title: "Approve production change",
      requestedBy: {
        source: "policy",
      },
    })

    const resolvedApproval = await approvalService.resolve(approval.id, "denied", "operator_002")
    const updatedRun = await runRepository.getById(run.id)

    expect(resolvedApproval.status).toBe("denied")
    expect(updatedRun?.status).toBe("failed")
    expect(updatedRun?.failureReason).toBe(`approval denied: ${approval.id}`)
  })

  it("scenario 4.4: rejects resolution when no pending approval exists", async () => {
    const { approvalService, run } = await createRunningRun()
    const approval = await approvalService.createApproval({
      runId: run.id,
      actionClass: "pr_creation",
      title: "Approve PR creation",
      requestedBy: {
        source: "policy",
      },
    })

    await approvalService.resolve(approval.id, "approved", "operator_001")

    await expect(approvalService.resolve(approval.id, "approved", "operator_002")).rejects.toThrow(
      `No pending approval exists for run: ${run.id}`,
    )
  })
})
