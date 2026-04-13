import { randomUUID } from "node:crypto"

import {
  RoleSpecCreateSchema,
  type RoleSpecCreateInput,
} from "@pluto-agent-platform/contracts"

import type { RoleSpecRecord, RoleSpecRepository } from "../repositories.js"

export class RoleService {
  constructor(private readonly roleRepository: RoleSpecRepository) {}

  async create(input: RoleSpecCreateInput): Promise<RoleSpecRecord> {
    const role = RoleSpecCreateSchema.parse(input)
    const timestamp = new Date().toISOString()

    const record: RoleSpecRecord = {
      kind: "role",
      id: `role_${randomUUID()}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...role,
    }

    return this.roleRepository.save(record)
  }

  async getById(id: string): Promise<RoleSpecRecord | null> {
    return this.roleRepository.getById(id)
  }

  async list(): Promise<RoleSpecRecord[]> {
    return this.roleRepository.list()
  }
}
