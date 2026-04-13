import { randomUUID } from "node:crypto"

import {
  PlaybookCreateSchema,
  type PlaybookCreateInput,
} from "@pluto-agent-platform/contracts"

import type { PlaybookRecord, PlaybookRepository } from "../repositories.js"

export class PlaybookService {
  constructor(private readonly playbookRepository: PlaybookRepository) {}

  async create(input: PlaybookCreateInput): Promise<PlaybookRecord> {
    const playbook = PlaybookCreateSchema.parse(input)
    const timestamp = new Date().toISOString()

    const record: PlaybookRecord = {
      kind: "playbook",
      id: `pb_${randomUUID()}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      harnessId: null,
      harness: null,
      ...playbook,
    }

    return this.playbookRepository.save(record)
  }

  async getById(id: string): Promise<PlaybookRecord | null> {
    return this.playbookRepository.getById(id)
  }

  async list(): Promise<PlaybookRecord[]> {
    return this.playbookRepository.list()
  }
}
