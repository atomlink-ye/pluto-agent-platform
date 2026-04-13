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
} from "../index.js"

const createArtifactServices = () => {
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

  return {
    artifactRepository,
    artifactService,
    harnessService,
    playbookService,
    runService,
  }
}

const createArtifactRun = async () => {
  const services = createArtifactServices()
  const playbook = await services.playbookService.create({
    name: "artifact-playbook",
    description: "Playbook with required artifacts",
    goal: "Produce a retrospective artifact",
    instructions: "Generate the required deliverable",
    artifacts: [
      {
        type: "retro_document",
        format: "markdown",
      },
    ],
  })
  const harness = await services.harnessService.create({
    name: "artifact-harness",
    description: "Harness for artifact registration",
    phases: ["draft", "review"],
    requirements: {
      artifact_registration_required: true,
    },
  })

  await services.harnessService.attachToPlaybook(harness.id, playbook.id)

  const run = await services.runService.create(playbook.id, harness.id, { sprint: "SPR-42" })

  await services.runService.transition(run.id, "initializing")
  await services.runService.transition(run.id, "running")

  return {
    ...services,
    run,
  }
}

describe("ArtifactService", () => {
  it("scenario 5.1: registers an artifact linked to the run", async () => {
    const { artifactRepository, artifactService, run } = await createArtifactRun()

    const artifact = await artifactService.register({
      runId: run.id,
      type: "retro_document",
      title: "Sprint Retro Draft",
      format: "markdown",
      producer: {
        role_id: "writer",
      },
    })

    const storedArtifact = await artifactRepository.getById(artifact.id)

    expect(storedArtifact).toEqual(
      expect.objectContaining({
        run_id: run.id,
        type: "retro_document",
        title: "Sprint Retro Draft",
      }),
    )
  })

  it("scenario 5.2: rejects success when a required artifact is missing", async () => {
    const { run, runService } = await createArtifactRun()

    await expect(runService.transition(run.id, "succeeded")).rejects.toThrow(
      "required artifact missing: retro_document",
    )
  })

  it("scenario 5.3: allows success when required artifacts are present", async () => {
    const { artifactService, run, runService } = await createArtifactRun()

    await artifactService.register({
      runId: run.id,
      type: "retro_document",
      title: "Sprint Retro Draft",
      format: "markdown",
    })

    const succeededRun = await runService.transition(run.id, "succeeded")

    expect(succeededRun.status).toBe("succeeded")
  })
})
