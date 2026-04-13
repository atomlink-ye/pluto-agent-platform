import { describe, expect, it } from "vitest"

import { InMemoryPlaybookRepository, PlaybookService } from "../index.js"

describe("PlaybookService", () => {
  it("scenario 1.1: creates a valid playbook", async () => {
    const service = new PlaybookService(new InMemoryPlaybookRepository())

    const created = await service.create({
      name: "sprint-retro-facilitator",
      description: "Prepare a sprint retrospective draft",
      goal: "Draft a retrospective from current sprint signals",
      instructions: "Collect evidence, summarize, and propose actions",
      inputs: [
        {
          name: "sprint_id",
          type: "string",
          required: true,
          description: "Sprint identifier",
        },
      ],
      artifacts: [
        {
          type: "retro_doc",
          format: "markdown",
          description: "Final retrospective document",
        },
      ],
      quality_bar: ["grounded in evidence", "actionable outcomes"],
    })

    expect(created.id).toMatch(/^pb_[0-9a-f-]+$/)
    expect(created.createdAt).toBeTypeOf("string")
    expect(created.updatedAt).toBe(created.createdAt)
    expect(created.kind).toBe("playbook")
    expect(created.name).toBe("sprint-retro-facilitator")
    expect(created.description).toBe("Prepare a sprint retrospective draft")
    expect(created.goal).toBe("Draft a retrospective from current sprint signals")
    expect(created.instructions).toBe("Collect evidence, summarize, and propose actions")
    expect(created.inputs).toEqual([
      {
        name: "sprint_id",
        type: "string",
        required: true,
        description: "Sprint identifier",
      },
    ])
    expect(created.artifacts).toEqual([
      {
        type: "retro_doc",
        format: "markdown",
        description: "Final retrospective document",
      },
    ])
    expect(created.quality_bar).toEqual(["grounded in evidence", "actionable outcomes"])
  })

  it("scenario 1.2: rejects a playbook missing required fields", async () => {
    const service = new PlaybookService(new InMemoryPlaybookRepository())

    await expect(
      service.create({
        name: "sprint-retro-facilitator",
        description: "Prepare a sprint retrospective draft",
        instructions: "Collect evidence, summarize, and propose actions",
      } as never),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ["goal"],
        }),
      ]),
    })
  })

  it("scenario 1.3: rejects harness-scoped fields in a playbook", async () => {
    const service = new PlaybookService(new InMemoryPlaybookRepository())

    await expect(
      service.create({
        name: "sprint-retro-facilitator",
        description: "Prepare a sprint retrospective draft",
        goal: "Draft a retrospective from current sprint signals",
        instructions: "Collect evidence, summarize, and propose actions",
        approval_policy: "required",
      } as never),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          message: "approval_policy belongs to Harness",
        }),
      ]),
    })
  })

  it("scenario 1.5: retrieves a single playbook by ID", async () => {
    const service = new PlaybookService(new InMemoryPlaybookRepository())

    const created = await service.create({
      name: "lookup-test",
      description: "Playbook for getById test",
      goal: "Test retrieval",
      instructions: "Retrieve by ID",
    })

    const fetched = await service.getById(created.id)

    expect(fetched).not.toBeNull()
    expect(fetched?.id).toBe(created.id)
    expect(fetched?.name).toBe("lookup-test")
  })

  it("scenario 1.5b: returns null for unknown ID", async () => {
    const service = new PlaybookService(new InMemoryPlaybookRepository())

    const fetched = await service.getById("pb_nonexistent")

    expect(fetched).toBeNull()
  })

  it("scenario 1.4: lists playbooks", async () => {
    const service = new PlaybookService(new InMemoryPlaybookRepository())

    await service.create({
      name: "playbook-one",
      description: "First playbook",
      goal: "Goal one",
      instructions: "Instructions one",
    })
    await service.create({
      name: "playbook-two",
      description: "Second playbook",
      goal: "Goal two",
      instructions: "Instructions two",
    })
    await service.create({
      name: "playbook-three",
      description: "Third playbook",
      goal: "Goal three",
      instructions: "Instructions three",
    })

    const playbooks = await service.list()

    expect(playbooks).toHaveLength(3)
    expect(playbooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "playbook-one",
          description: "First playbook",
          createdAt: expect.any(String),
        }),
        expect.objectContaining({
          name: "playbook-two",
          description: "Second playbook",
          createdAt: expect.any(String),
        }),
        expect.objectContaining({
          name: "playbook-three",
          description: "Third playbook",
          createdAt: expect.any(String),
        }),
      ]),
    )
  })
})
