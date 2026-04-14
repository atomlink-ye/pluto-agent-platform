import type { PolicySnapshot, RunEventEnvelope, RunPlan } from "@pluto-agent-platform/contracts"

import type {
  ApprovalRecord,
  ApprovalRepository,
  ArtifactRecord,
  ArtifactRepository,
  HarnessRecord,
  HarnessRepository,
  PlaybookRecord,
  PlaybookRepository,
  PolicySnapshotRepository,
  RoleSpecRecord,
  RoleSpecRepository,
  TeamSpecRecord,
  TeamSpecRepository,
  RunEventRepository,
  RunPlanRepository,
  RunRecord,
  RunRepository,
  RunSessionRecord,
  RunSessionRepository,
} from "../repositories.js"

const cloneRecord = <T>(record: T): T => structuredClone(record)

export class InMemoryPlaybookRepository implements PlaybookRepository {
  private readonly records = new Map<string, PlaybookRecord>()

  async save(playbook: PlaybookRecord): Promise<PlaybookRecord> {
    const stored = cloneRecord(playbook)

    this.records.set(playbook.id, stored)

    return cloneRecord(stored)
  }

  async getById(id: string): Promise<PlaybookRecord | null> {
    const playbook = this.records.get(id)

    return playbook ? cloneRecord(playbook) : null
  }

  async list(): Promise<PlaybookRecord[]> {
    return Array.from(this.records.values())
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => cloneRecord(record))
  }

  async update(playbook: PlaybookRecord): Promise<PlaybookRecord> {
    if (!this.records.has(playbook.id)) {
      throw new Error(`Playbook not found: ${playbook.id}`)
    }

    const stored = cloneRecord(playbook)

    this.records.set(playbook.id, stored)

    return cloneRecord(stored)
  }
}

export class InMemoryHarnessRepository implements HarnessRepository {
  private readonly records = new Map<string, HarnessRecord>()

  async save(harness: HarnessRecord): Promise<HarnessRecord> {
    const stored = cloneRecord(harness)

    this.records.set(harness.id, stored)

    return cloneRecord(stored)
  }

  async getById(id: string): Promise<HarnessRecord | null> {
    const harness = this.records.get(id)

    return harness ? cloneRecord(harness) : null
  }

  async list(): Promise<HarnessRecord[]> {
    return Array.from(this.records.values())
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => cloneRecord(record))
  }
}

export class InMemoryRoleSpecRepository implements RoleSpecRepository {
  private readonly records = new Map<string, RoleSpecRecord>()

  async save(role: RoleSpecRecord): Promise<RoleSpecRecord> {
    const stored = cloneRecord(role)

    this.records.set(role.id, stored)

    return cloneRecord(stored)
  }

  async getById(id: string): Promise<RoleSpecRecord | null> {
    const role = this.records.get(id)

    return role ? cloneRecord(role) : null
  }

  async list(): Promise<RoleSpecRecord[]> {
    return Array.from(this.records.values())
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => cloneRecord(record))
  }

  async update(role: RoleSpecRecord): Promise<RoleSpecRecord> {
    if (!this.records.has(role.id)) {
      throw new Error(`RoleSpec not found: ${role.id}`)
    }

    const stored = cloneRecord(role)

    this.records.set(role.id, stored)

    return cloneRecord(stored)
  }
}

export class InMemoryTeamSpecRepository implements TeamSpecRepository {
  private readonly records = new Map<string, TeamSpecRecord>()

  async save(team: TeamSpecRecord): Promise<TeamSpecRecord> {
    const stored = cloneRecord(team)

    this.records.set(team.id, stored)

    return cloneRecord(stored)
  }

  async getById(id: string): Promise<TeamSpecRecord | null> {
    const team = this.records.get(id)

    return team ? cloneRecord(team) : null
  }

  async list(): Promise<TeamSpecRecord[]> {
    return Array.from(this.records.values())
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => cloneRecord(record))
  }

  async update(team: TeamSpecRecord): Promise<TeamSpecRecord> {
    if (!this.records.has(team.id)) {
      throw new Error(`TeamSpec not found: ${team.id}`)
    }

    const stored = cloneRecord(team)

    this.records.set(team.id, stored)

    return cloneRecord(stored)
  }
}

export class InMemoryRunRepository implements RunRepository {
  private readonly records = new Map<string, RunRecord>()

  async save(run: RunRecord): Promise<RunRecord> {
    const stored = cloneRecord(run)

    this.records.set(run.id, stored)

    return cloneRecord(stored)
  }

  async getById(id: string): Promise<RunRecord | null> {
    const run = this.records.get(id)

    return run ? cloneRecord(run) : null
  }

  async list(): Promise<RunRecord[]> {
    return Array.from(this.records.values())
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => cloneRecord(record))
  }

  async update(run: RunRecord): Promise<RunRecord> {
    if (!this.records.has(run.id)) {
      throw new Error(`Run not found: ${run.id}`)
    }

    const stored = cloneRecord(run)

    this.records.set(run.id, stored)

    return cloneRecord(stored)
  }
}

export class InMemoryRunEventRepository implements RunEventRepository {
  private readonly events = new Map<string, RunEventEnvelope[]>()

  async append(event: RunEventEnvelope): Promise<RunEventEnvelope> {
    const existing = this.events.get(event.runId) ?? []
    const stored = cloneRecord(event)

    existing.push(stored)
    this.events.set(event.runId, existing)

    return cloneRecord(stored)
  }

  async listByRunId(runId: string): Promise<RunEventEnvelope[]> {
    return (this.events.get(runId) ?? [])
      .slice()
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
      .map((event) => cloneRecord(event))
  }
}

export class InMemoryRunPlanRepository implements RunPlanRepository {
  private readonly records = new Map<string, RunPlan>()

  async save(runPlan: RunPlan): Promise<RunPlan> {
    const stored = cloneRecord(runPlan)

    this.records.set(runPlan.run_id, stored)

    return cloneRecord(stored)
  }

  async getByRunId(runId: string): Promise<RunPlan | null> {
    const runPlan = this.records.get(runId)

    return runPlan ? cloneRecord(runPlan) : null
  }
}

export class InMemoryPolicySnapshotRepository implements PolicySnapshotRepository {
  private readonly records = new Map<string, PolicySnapshot>()

  async save(policySnapshot: PolicySnapshot): Promise<PolicySnapshot> {
    const stored = cloneRecord(policySnapshot)

    this.records.set(policySnapshot.run_id, stored)

    return cloneRecord(stored)
  }

  async getByRunId(runId: string): Promise<PolicySnapshot | null> {
    const policySnapshot = this.records.get(runId)

    return policySnapshot ? cloneRecord(policySnapshot) : null
  }
}

export class InMemoryApprovalRepository implements ApprovalRepository {
  private readonly records = new Map<string, ApprovalRecord>()

  async save(approval: ApprovalRecord): Promise<ApprovalRecord> {
    const stored = cloneRecord(approval)

    this.records.set(approval.id, stored)

    return cloneRecord(stored)
  }

  async getById(id: string): Promise<ApprovalRecord | null> {
    const approval = this.records.get(id)

    return approval ? cloneRecord(approval) : null
  }

  async list(): Promise<ApprovalRecord[]> {
    return Array.from(this.records.values())
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((approval) => cloneRecord(approval))
  }

  async listByRunId(runId: string): Promise<ApprovalRecord[]> {
    return Array.from(this.records.values())
      .filter((approval) => approval.run_id === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((approval) => cloneRecord(approval))
  }

  async update(approval: ApprovalRecord): Promise<ApprovalRecord> {
    if (!this.records.has(approval.id)) {
      throw new Error(`Approval not found: ${approval.id}`)
    }

    const stored = cloneRecord(approval)

    this.records.set(approval.id, stored)

    return cloneRecord(stored)
  }
}

export class InMemoryArtifactRepository implements ArtifactRepository {
  private readonly records = new Map<string, ArtifactRecord>()

  async save(artifact: ArtifactRecord): Promise<ArtifactRecord> {
    const stored = cloneRecord(artifact)

    this.records.set(artifact.id, stored)

    return cloneRecord(stored)
  }

  async getById(id: string): Promise<ArtifactRecord | null> {
    const artifact = this.records.get(id)

    return artifact ? cloneRecord(artifact) : null
  }

  async listByRunId(runId: string): Promise<ArtifactRecord[]> {
    return Array.from(this.records.values())
      .filter((artifact) => artifact.run_id === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((artifact) => cloneRecord(artifact))
  }
}

export class InMemoryRunSessionRepository implements RunSessionRepository {
  private readonly records = new Map<string, RunSessionRecord>()

  async save(session: RunSessionRecord): Promise<RunSessionRecord> {
    const stored = cloneRecord(session)

    this.records.set(session.id, stored)

    return cloneRecord(stored)
  }

  async getById(id: string): Promise<RunSessionRecord | null> {
    const session = this.records.get(id)

    return session ? cloneRecord(session) : null
  }

  async listByRunId(runId: string): Promise<RunSessionRecord[]> {
    return Array.from(this.records.values())
      .filter((session) => session.run_id === runId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((session) => cloneRecord(session))
  }

  async update(session: RunSessionRecord): Promise<RunSessionRecord> {
    if (!this.records.has(session.id)) {
      throw new Error(`RunSession not found: ${session.id}`)
    }

    const stored = cloneRecord(session)

    this.records.set(session.id, stored)

    return cloneRecord(stored)
  }
}
