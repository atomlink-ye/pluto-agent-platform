import crypto from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  ArtifactService,
  HarnessService,
  InMemoryArtifactRepository,
  InMemoryHarnessRepository,
  InMemoryPlaybookRepository,
  InMemoryPolicySnapshotRepository,
  InMemoryRunEventRepository,
  InMemoryRunPlanRepository,
  InMemoryRunRepository,
  PlaybookService,
  RunService,
  projectRunStateFromEvents,
} from "../index.js"

const createServices = () => {
  const playbookRepository = new InMemoryPlaybookRepository()
  const harnessRepository = new InMemoryHarnessRepository()
  const runRepository = new InMemoryRunRepository()
  const runEventRepository = new InMemoryRunEventRepository()
  const runPlanRepository = new InMemoryRunPlanRepository()
  const policySnapshotRepository = new InMemoryPolicySnapshotRepository()
  const artifactRepository = new InMemoryArtifactRepository()

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

  return {
    artifactService,
    harnessService,
    playbookService,
    policySnapshotRepository,
    runEventRepository,
    runPlanRepository,
    runRepository,
    runService,
  }
}

const createGovernedRun = async (options?: { artifacts?: { type: string; format?: string }[] }) => {
  const services = createServices()
  const playbook = await services.playbookService.create({
    name: "retro-playbook",
    description: "Create a sprint retrospective",
    goal: "Produce a retrospective document",
    instructions: "Collect sprint evidence and summarize outcomes",
    artifacts: options?.artifacts,
  })
  const harness = await services.harnessService.create({
    name: "retro-harness",
    description: "Governed retrospective harness",
    phases: ["collect", "review"],
    approvals: {
      pr_creation: "required",
    },
    timeouts: {
      total_minutes: 20,
    },
    requirements: {
      artifact_registration_required: true,
    },
  })

  await services.harnessService.attachToPlaybook(harness.id, playbook.id)

  const run = await services.runService.create(playbook.id, harness.id, {
    sprint_id: "SPR-42",
  })

  return {
    ...services,
    harness,
    playbook,
    run,
  }
}

describe("RunService", () => {
  it("scenario 3.1: creates a run from playbook and harness", async () => {
    const { policySnapshotRepository, playbook, harness, run, runEventRepository, runPlanRepository } =
      await createGovernedRun({
        artifacts: [{ type: "retro_document", format: "markdown" }],
      })

    const runPlan = await runPlanRepository.getByRunId(run.id)
    const policySnapshot = await policySnapshotRepository.getByRunId(run.id)
    const events = await runEventRepository.listByRunId(run.id)

    expect(run.status).toBe("queued")
    expect(run.playbook).toBe(playbook.id)
    expect(run.harness).toBe(harness.id)
    expect(runPlan).toEqual({
      kind: "run_plan",
      run_id: run.id,
      current_phase: "collect",
      stages: [
        {
          id: "stage_1_collect",
          phase: "collect",
          status: "pending",
        },
        {
          id: "stage_2_review",
          phase: "review",
          status: "pending",
        },
      ],
    })
    expect(policySnapshot).toEqual({
      kind: "policy_snapshot",
      run_id: run.id,
      approvals: { pr_creation: "required" },
      timeouts: { total_minutes: 20 },
      requirements: { artifact_registration_required: true },
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "run.created",
          runId: run.id,
        }),
      ]),
    )
  })

  it("scenario 3.2: appends a status change event for valid transitions", async () => {
    const { run, runEventRepository, runService } = await createGovernedRun()

    await runService.transition(run.id, "initializing")
    await runService.transition(run.id, "running")
    const updatedRun = await runService.transition(run.id, "waiting_approval")

    const events = await runEventRepository.listByRunId(run.id)

    expect(updatedRun.status).toBe("waiting_approval")
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "run.status_changed",
          payload: expect.objectContaining({
            fromStatus: "running",
            toStatus: "waiting_approval",
          }),
        }),
      ]),
    )
  })

  it("scenario 3.3: rejects invalid state transitions", async () => {
    const { run, runService } = await createGovernedRun()

    await runService.transition(run.id, "initializing")
    await runService.transition(run.id, "running")
    await runService.transition(run.id, "succeeded")

    await expect(runService.transition(run.id, "running")).rejects.toThrow(
      "Invalid run status transition: succeeded -> running",
    )
  })

  it("scenario 3.4: records failure reason when a run fails", async () => {
    const { run, runService } = await createGovernedRun()

    await runService.transition(run.id, "initializing")
    await runService.transition(run.id, "running")
    const failedRun = await runService.transition(run.id, "failed", {
      failureReason: "required artifact missing",
    })

    expect(failedRun.status).toBe("failed")
    expect(failedRun.failureReason).toBe("required artifact missing")
  })

  it("scenario 3.4b: records blocker reason when a run is blocked", async () => {
    const { run, runService } = await createGovernedRun()

    await runService.transition(run.id, "initializing")
    await runService.transition(run.id, "running")
    const blockedRun = await runService.transition(run.id, "blocked", {
      blockerReason: "waiting for external dependency",
    })

    expect(blockedRun.status).toBe("blocked")
    expect(blockedRun.blockerReason).toBe("waiting for external dependency")
  })

  it("scenario 3.5: projects final state from durable events", async () => {
    const { runEventRepository } = createServices()
    const runId = `run_${crypto.randomUUID()}`
    const approvalId = `appr_${crypto.randomUUID()}`

    await runEventRepository.append({
      id: `evt_${crypto.randomUUID()}`,
      runId,
      eventType: "run.created",
      occurredAt: "2026-04-14T10:00:00.000Z",
      source: "system",
      payload: {},
    })
    await runEventRepository.append({
      id: `evt_${crypto.randomUUID()}`,
      runId,
      eventType: "run.started",
      occurredAt: "2026-04-14T10:01:00.000Z",
      source: "system",
      payload: {},
    })
    await runEventRepository.append({
      id: `evt_${crypto.randomUUID()}`,
      runId,
      eventType: "phase.entered",
      occurredAt: "2026-04-14T10:02:00.000Z",
      source: "system",
      phase: "collect",
      payload: {},
    })
    await runEventRepository.append({
      id: `evt_${crypto.randomUUID()}`,
      runId,
      eventType: "phase.exited",
      occurredAt: "2026-04-14T10:03:00.000Z",
      source: "system",
      phase: "collect",
      payload: {},
    })
    await runEventRepository.append({
      id: `evt_${crypto.randomUUID()}`,
      runId,
      eventType: "approval.requested",
      occurredAt: "2026-04-14T10:04:00.000Z",
      source: "policy",
      payload: {
        approvalId,
      },
    })
    await runEventRepository.append({
      id: `evt_${crypto.randomUUID()}`,
      runId,
      eventType: "approval.resolved",
      occurredAt: "2026-04-14T10:05:00.000Z",
      source: "operator",
      payload: {
        approvalId,
        decision: "approved",
      },
    })
    await runEventRepository.append({
      id: `evt_${crypto.randomUUID()}`,
      runId,
      eventType: "run.succeeded",
      occurredAt: "2026-04-14T10:06:00.000Z",
      source: "system",
      payload: {},
    })

    const projected = projectRunStateFromEvents(await runEventRepository.listByRunId(runId))

    expect(projected.status).toBe("succeeded")
    expect(projected.completedPhases).toEqual(["collect"])
    expect(projected.approvals.pending).toEqual([])
    expect(projected.approvals.resolved).toEqual([approvalId])
  })
})
