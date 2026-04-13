import { randomUUID } from "node:crypto"

import {
  TeamSpecCreateSchema,
  type TeamSpecCreateInput,
} from "@pluto-agent-platform/contracts"

import type {
  RoleSpecRepository,
  TeamSpecRecord,
  TeamSpecRepository,
} from "../repositories.js"

export class TeamService {
  constructor(
    private readonly teamRepository: TeamSpecRepository,
    private readonly roleRepository: RoleSpecRepository,
  ) {}

  async create(input: TeamSpecCreateInput): Promise<TeamSpecRecord> {
    const parsed = TeamSpecCreateSchema.parse(input)

    const missingRoleIds = (
      await Promise.all(parsed.roles.map(async (roleId) => ((await this.roleRepository.getById(roleId)) ? null : roleId)))
    ).filter((roleId): roleId is string => roleId !== null)

    if (missingRoleIds.length > 0) {
      throw new Error(`Unknown role reference(s): ${missingRoleIds.join(", ")}`)
    }

    const coordination = {
      mode: "supervisor-led" as const,
      ...parsed.coordination,
    }

    const timestamp = new Date().toISOString()

    const record: TeamSpecRecord = {
      kind: "team",
      id: `team_${randomUUID()}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...parsed,
      coordination,
    }

    return this.teamRepository.save(record)
  }

  async getById(id: string): Promise<TeamSpecRecord | null> {
    return this.teamRepository.getById(id)
  }

  async list(): Promise<TeamSpecRecord[]> {
    return this.teamRepository.list()
  }
}
