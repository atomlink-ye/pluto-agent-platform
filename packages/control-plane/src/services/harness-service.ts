import { randomUUID } from "node:crypto"

import {
  HarnessCreateSchema,
  type HarnessCreateInput,
} from "@pluto-agent-platform/contracts"

import type {
  HarnessRecord,
  HarnessRepository,
  HarnessSummary,
  PlaybookRecord,
  PlaybookRepository,
} from "../repositories.js"

const toHarnessSummary = (harness: HarnessRecord): HarnessSummary => ({
  id: harness.id,
  name: harness.name,
  description: harness.description,
  phases: [...harness.phases],
})

export class HarnessService {
  constructor(
    private readonly harnessRepository: HarnessRepository,
    private readonly playbookRepository: PlaybookRepository,
  ) {}

  async create(input: HarnessCreateInput): Promise<HarnessRecord> {
    const harness = HarnessCreateSchema.parse(input)
    const timestamp = new Date().toISOString()

    const record: HarnessRecord = {
      kind: "harness",
      id: `hs_${randomUUID()}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...harness,
    }

    return this.harnessRepository.save(record)
  }

  async getById(id: string): Promise<HarnessRecord | null> {
    return this.harnessRepository.getById(id)
  }

  async attachToPlaybook(harnessId: string, playbookId: string): Promise<PlaybookRecord> {
    const [harness, playbook] = await Promise.all([
      this.harnessRepository.getById(harnessId),
      this.playbookRepository.getById(playbookId),
    ])

    if (!harness) {
      throw new Error(`Harness not found: ${harnessId}`)
    }

    if (!playbook) {
      throw new Error(`Playbook not found: ${playbookId}`)
    }

    const updatedPlaybook: PlaybookRecord = {
      ...playbook,
      harnessId: harness.id,
      harness: toHarnessSummary(harness),
      updatedAt: new Date().toISOString(),
    }

    return this.playbookRepository.update(updatedPlaybook)
  }
}
