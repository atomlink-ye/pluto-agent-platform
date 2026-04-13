import type {
  Approval,
  Artifact,
  Harness,
  Playbook,
  PolicySnapshot,
  Run,
  RunEventEnvelope,
  RunPlan,
  RunSession,
} from "@pluto-agent-platform/contracts"

export interface DomainRecord {
  id: string
  createdAt: string
  updatedAt: string
}

export interface HarnessSummary {
  id: string
  name: string
  description: string
  phases: string[]
}

export interface PlaybookRecord extends Playbook, DomainRecord {
  harnessId?: string | null
  harness?: HarnessSummary | null
}

export interface HarnessRecord extends Harness, DomainRecord {}

export interface RunRecord extends Run, DomainRecord {}

export interface ApprovalRecord extends Approval, DomainRecord {}

export interface ArtifactRecord extends Artifact, DomainRecord {}

export interface PlaybookRepository {
  save(playbook: PlaybookRecord): Promise<PlaybookRecord>
  getById(id: string): Promise<PlaybookRecord | null>
  list(): Promise<PlaybookRecord[]>
  update(playbook: PlaybookRecord): Promise<PlaybookRecord>
}

export interface HarnessRepository {
  save(harness: HarnessRecord): Promise<HarnessRecord>
  getById(id: string): Promise<HarnessRecord | null>
  list(): Promise<HarnessRecord[]>
}

export interface RunRepository {
  save(run: RunRecord): Promise<RunRecord>
  getById(id: string): Promise<RunRecord | null>
  update(run: RunRecord): Promise<RunRecord>
}

export interface RunEventRepository {
  append(event: RunEventEnvelope): Promise<RunEventEnvelope>
  listByRunId(runId: string): Promise<RunEventEnvelope[]>
}

export interface RunPlanRepository {
  save(runPlan: RunPlan): Promise<RunPlan>
  getByRunId(runId: string): Promise<RunPlan | null>
}

export interface PolicySnapshotRepository {
  save(policySnapshot: PolicySnapshot): Promise<PolicySnapshot>
  getByRunId(runId: string): Promise<PolicySnapshot | null>
}

export interface ApprovalRepository {
  save(approval: ApprovalRecord): Promise<ApprovalRecord>
  getById(id: string): Promise<ApprovalRecord | null>
  listByRunId(runId: string): Promise<ApprovalRecord[]>
  update(approval: ApprovalRecord): Promise<ApprovalRecord>
}

export interface ArtifactRepository {
  save(artifact: ArtifactRecord): Promise<ArtifactRecord>
  getById(id: string): Promise<ArtifactRecord | null>
  listByRunId(runId: string): Promise<ArtifactRecord[]>
}

export interface RunSessionRecord extends RunSession, DomainRecord {}

export interface RunSessionRepository {
  save(session: RunSessionRecord): Promise<RunSessionRecord>
  getById(id: string): Promise<RunSessionRecord | null>
  listByRunId(runId: string): Promise<RunSessionRecord[]>
  update(session: RunSessionRecord): Promise<RunSessionRecord>
}
