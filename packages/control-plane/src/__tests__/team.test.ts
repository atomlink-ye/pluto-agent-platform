import { describe, expect, it } from "vitest"

import {
  InMemoryRoleSpecRepository,
  InMemoryTeamSpecRepository,
  RoleService,
  TeamService,
} from "../index.js"

describe("TeamService", () => {
  it("scenario 2.1: creates a valid team with roles and lead_role", async () => {
    const roleRepository = new InMemoryRoleSpecRepository()
    const service = new TeamService(new InMemoryTeamSpecRepository(), roleRepository)
    const roleService = new RoleService(roleRepository)

    const researcher = await roleService.create({
      name: "Researcher",
      description: "Gathers information",
    })
    const analyst = await roleService.create({
      name: "Analyst",
      description: "Synthesizes findings",
    })
    const reviewer = await roleService.create({
      name: "Reviewer",
      description: "Checks quality and completeness",
    })

    const created = await service.create({
      name: "Retro Team",
      description: "Role set for preparing a sprint retrospective",
      lead_role: analyst.id,
      roles: [researcher.id, analyst.id, reviewer.id],
    })

    expect(created.id).toMatch(/^team_[0-9a-f-]+$/)
    expect(created.createdAt).toBeTypeOf("string")
    expect(created.updatedAt).toBe(created.createdAt)
    expect(created.kind).toBe("team")
    expect(created.lead_role).toBe(analyst.id)
    expect(created.roles).toEqual([researcher.id, analyst.id, reviewer.id])
    expect(created.coordination).toEqual({ mode: "supervisor-led" })
  })

  it("scenario 2.2: rejects unknown role reference", async () => {
    const roleRepository = new InMemoryRoleSpecRepository()
    const service = new TeamService(new InMemoryTeamSpecRepository(), roleRepository)
    const roleService = new RoleService(roleRepository)

    const analyst = await roleService.create({
      name: "Analyst",
      description: "Synthesizes findings",
    })

    await expect(
      service.create({
        name: "Retro Team",
        description: "Role set for preparing a sprint retrospective",
        lead_role: analyst.id,
        roles: [analyst.id, "role_missing"],
      }),
    ).rejects.toThrow("Unknown role reference(s): role_missing")
  })

  it("scenario 2.3: list teams returns all teams", async () => {
    const roleRepository = new InMemoryRoleSpecRepository()
    const service = new TeamService(new InMemoryTeamSpecRepository(), roleRepository)
    const roleService = new RoleService(roleRepository)

    const researcher = await roleService.create({
      name: "Researcher",
      description: "Gathers information",
    })
    const analyst = await roleService.create({
      name: "Analyst",
      description: "Synthesizes findings",
    })

    await service.create({
      name: "Retro Team",
      description: "Role set for preparing a sprint retrospective",
      lead_role: analyst.id,
      roles: [researcher.id, analyst.id],
    })
    await service.create({
      name: "Review Team",
      description: "Role set for review workflows",
      lead_role: researcher.id,
      roles: [researcher.id],
    })

    const teams = await service.list()

    expect(teams).toHaveLength(2)
    expect(teams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Retro Team" }),
        expect.objectContaining({ name: "Review Team" }),
      ]),
    )
  })

  it("scenario 2.4: defaults coordination mode to supervisor-led", async () => {
    const roleRepository = new InMemoryRoleSpecRepository()
    const service = new TeamService(new InMemoryTeamSpecRepository(), roleRepository)
    const roleService = new RoleService(roleRepository)

    const analyst = await roleService.create({
      name: "Analyst",
      description: "Synthesizes findings",
    })

    const created = await service.create({
      name: "Retro Team",
      description: "Role set for preparing a sprint retrospective",
      lead_role: analyst.id,
      roles: [analyst.id],
      coordination: {
        shared_room: true,
        heartbeat_minutes: 5,
      },
    })

    expect(created.coordination).toEqual({
      mode: "supervisor-led",
      shared_room: true,
      heartbeat_minutes: 5,
    })
  })

  it("scenario 2.5: rejects lead_role that is not in roles", async () => {
    const roleRepository = new InMemoryRoleSpecRepository()
    const service = new TeamService(new InMemoryTeamSpecRepository(), roleRepository)
    const roleService = new RoleService(roleRepository)

    const researcher = await roleService.create({
      name: "Researcher",
      description: "Gathers information",
    })
    const analyst = await roleService.create({
      name: "Analyst",
      description: "Synthesizes findings",
    })

    await expect(
      service.create({
        name: "Retro Team",
        description: "Role set for preparing a sprint retrospective",
        lead_role: analyst.id,
        roles: [researcher.id],
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ message: "lead_role must be included in roles" }),
      ]),
    })
  })
})
