import { describe, expect, it } from "vitest"

import { InMemoryRoleSpecRepository, RoleService } from "../index.js"

describe("RoleService", () => {
  it("scenario 1.1: creates a valid role with name and description", async () => {
    const service = new RoleService(new InMemoryRoleSpecRepository())

    const created = await service.create({
      name: "Researcher",
      description: "Gathers information",
    })

    expect(created.id).toMatch(/^role_[0-9a-f-]+$/)
    expect(created.createdAt).toBeTypeOf("string")
    expect(created.updatedAt).toBe(created.createdAt)
    expect(created.kind).toBe("role")
    expect(created.name).toBe("Researcher")
    expect(created.description).toBe("Gathers information")
  })

  it("scenario 1.2: rejects governance-scoped fields", async () => {
    const service = new RoleService(new InMemoryRoleSpecRepository())

    await expect(
      service.create({
        name: "Researcher",
        description: "Gathers information",
        approvals: { review: "required" },
        timeouts: { total_minutes: 5 },
        requirements: { artifact_registration_required: true },
      } as never),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          message: "approvals belongs to Harness or higher-level policy, not RoleSpec",
        }),
        expect.objectContaining({
          message: "timeouts belongs to Harness or higher-level policy, not RoleSpec",
        }),
        expect.objectContaining({
          message: "requirements belongs to Harness or higher-level policy, not RoleSpec",
        }),
      ]),
    })
  })

  it("scenario 1.3: list roles returns all roles", async () => {
    const service = new RoleService(new InMemoryRoleSpecRepository())

    await service.create({
      name: "Researcher",
      description: "Gathers information",
    })
    await service.create({
      name: "Analyst",
      description: "Synthesizes findings",
    })
    await service.create({
      name: "Reviewer",
      description: "Checks quality and completeness",
    })

    const roles = await service.list()

    expect(roles).toHaveLength(3)
    expect(roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Researcher", description: "Gathers information" }),
        expect.objectContaining({ name: "Analyst", description: "Synthesizes findings" }),
        expect.objectContaining({ name: "Reviewer", description: "Checks quality and completeness" }),
      ]),
    )
  })

  it("scenario 1.4: optional fields persist correctly", async () => {
    const service = new RoleService(new InMemoryRoleSpecRepository())

    const created = await service.create({
      name: "Researcher",
      description: "Gathers information",
      system_prompt: "Focus on source-backed findings",
      tools: ["websearch", "read"],
      provider_preset: "balanced",
      memory_scope: "project",
      isolation: "worktree",
      background: true,
      hooks: [{ event: "before_start" }],
      metadata: { domain: "research" },
    })

    const fetched = await service.getById(created.id)

    expect(fetched).toEqual(
      expect.objectContaining({
        id: created.id,
        system_prompt: "Focus on source-backed findings",
        tools: ["websearch", "read"],
        provider_preset: "balanced",
        memory_scope: "project",
        isolation: "worktree",
        background: true,
        hooks: [{ event: "before_start" }],
        metadata: { domain: "research" },
      }),
    )
  })
})
