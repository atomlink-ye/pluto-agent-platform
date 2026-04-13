import crypto from "node:crypto"

import type { Artifact } from "@pluto-agent-platform/contracts"

import type {
  ArtifactRecord,
  ArtifactRepository,
  PlaybookRepository,
  RunEventRepository,
  RunRepository,
} from "../repositories.js"

export interface ArtifactRegistrationInput {
  runId: string
  type: string
  title: string
  producer?: Artifact["producer"]
  format?: string
}

export interface RequiredArtifactCheckResult {
  missingTypes: string[]
}

const isArtifactExpectationSatisfied = (
  expectation: { type: string; format?: string },
  artifacts: ArtifactRecord[],
): boolean =>
  artifacts.some(
    (artifact) =>
      artifact.type === expectation.type &&
      (expectation.format === undefined || artifact.format === expectation.format),
  )

export class ArtifactService {
  constructor(
    private readonly artifactRepository: ArtifactRepository,
    private readonly runRepository: RunRepository,
    private readonly playbookRepository: PlaybookRepository,
    private readonly runEventRepository: RunEventRepository,
  ) {}

  async register({
    runId,
    type,
    title,
    producer,
    format,
  }: ArtifactRegistrationInput): Promise<ArtifactRecord> {
    const run = await this.runRepository.getById(runId)

    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }

    const timestamp = new Date().toISOString()
    const artifact: ArtifactRecord = {
      kind: "artifact",
      id: `art_${crypto.randomUUID()}`,
      run_id: runId,
      type,
      title,
      producer,
      format,
      status: "registered",
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const savedArtifact = await this.artifactRepository.save(artifact)

    await this.runEventRepository.append({
      id: `evt_${crypto.randomUUID()}`,
      runId,
      eventType: "artifact.registered",
      occurredAt: timestamp,
      source: "system",
      roleId: producer?.role_id ?? null,
      sessionId: producer?.session_id ?? null,
      payload: {
        artifactId: savedArtifact.id,
        type: savedArtifact.type,
        title: savedArtifact.title,
        format: savedArtifact.format,
      },
    })

    return savedArtifact
  }

  async checkRequiredArtifacts(runId: string): Promise<RequiredArtifactCheckResult> {
    const run = await this.runRepository.getById(runId)

    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }

    const playbook = await this.playbookRepository.getById(run.playbook)

    if (!playbook) {
      throw new Error(`Playbook not found: ${run.playbook}`)
    }

    const artifacts = await this.artifactRepository.listByRunId(runId)
    const expectations = playbook.artifacts ?? []
    const missingTypes = expectations
      .filter((expectation) => !isArtifactExpectationSatisfied(expectation, artifacts))
      .map((expectation) => expectation.type)

    return { missingTypes }
  }
}
