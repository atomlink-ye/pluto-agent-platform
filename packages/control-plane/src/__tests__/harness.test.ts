import { describe, expect, it } from "vitest"

import {
  HarnessService,
  InMemoryHarnessRepository,
  InMemoryPlaybookRepository,
  PlaybookService,
} from "../index.js"

describe("HarnessService", () => {
  it("scenario 2.1: creates a valid harness", async () => {
    const service = new HarnessService(
      new InMemoryHarnessRepository(),
      new InMemoryPlaybookRepository(),
    )

    const created = await service.create({
      name: "standard-review-harness",
      description: "Collect, analyze, and review work",
      phases: ["collect", "analyze", "review"],
      approvals: {
        review: "required",
      },
    })

    expect(created.id).toMatch(/^hs_[0-9a-f-]+$/)
    expect(created.createdAt).toBeTypeOf("string")
    expect(created.updatedAt).toBe(created.createdAt)
    expect(created.kind).toBe("harness")
    expect(created.phases).toEqual(["collect", "analyze", "review"])
    expect(created.approvals).toEqual({ review: "required" })
  })

  it("scenario 2.2: rejects duplicate phase names", async () => {
    const service = new HarnessService(
      new InMemoryHarnessRepository(),
      new InMemoryPlaybookRepository(),
    )

    await expect(
      service.create({
        name: "duplicate-phase-harness",
        description: "Has duplicate phases",
        phases: ["collect", "collect", "review"],
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("collect"),
        }),
      ]),
    })
  })

  it("scenario 2.3: rejects task-intent fields in a harness", async () => {
    const service = new HarnessService(
      new InMemoryHarnessRepository(),
      new InMemoryPlaybookRepository(),
    )

    await expect(
      service.create({
        name: "invalid-harness",
        description: "Contains playbook fields",
        phases: ["collect", "review"],
        goal: "This should not be here",
      } as never),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          message: "goal belongs to Playbook",
        }),
      ]),
    })
  })

  it("scenario 2.4: attaches a harness to a playbook", async () => {
    const playbookRepository = new InMemoryPlaybookRepository()
    const harnessRepository = new InMemoryHarnessRepository()
    const playbookService = new PlaybookService(playbookRepository)
    const harnessService = new HarnessService(harnessRepository, playbookRepository)

    const playbook = await playbookService.create({
      name: "research-playbook",
      description: "Run a research workflow",
      goal: "Produce a grounded recommendation",
      instructions: "Collect sources, analyze them, and summarize findings",
    })
    const harness = await harnessService.create({
      name: "research-harness",
      description: "Standard governed research harness",
      phases: ["collect", "analyze", "review"],
      approvals: {
        review: "required",
      },
    })

    const attached = await harnessService.attachToPlaybook(harness.id, playbook.id)
    const fetched = await playbookService.getById(playbook.id)

    expect(attached.harnessId).toBe(harness.id)
    expect(attached.harness).toEqual({
      id: harness.id,
      name: "research-harness",
      description: "Standard governed research harness",
      phases: ["collect", "analyze", "review"],
    })
    expect(fetched?.harness).toEqual(attached.harness)
  })
})
