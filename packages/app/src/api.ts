import type {
  Approval,
  ApprovalDecision,
  ApprovalStatus,
  Artifact,
  Harness,
  InputSpec,
  Playbook,
  Run,
  RunEventEnvelope,
  RunSession,
} from "@pluto-agent-platform/contracts"

const BASE = "/api"

interface TimestampedRecord {
  createdAt?: string
  updatedAt?: string
}

export interface HarnessSummary extends Partial<Harness>, TimestampedRecord {
  id: string
  name: string
  description?: string
  phases?: string[]
  quality_bar?: string[]
}

export interface PlaybookRecord extends Playbook, TimestampedRecord {
  id: string
  harnessId?: string | null
  harness?: HarnessSummary | null
  harnesses?: HarnessSummary[]
  harness_count?: number
  run_count?: number
}

export interface RunRecord extends Omit<Run, "harness">, TimestampedRecord {
  harness: string | null
  playbookName?: string
  playbook_name?: string
  harnessName?: string
  harness_name?: string
  startedAt?: string
  completedAt?: string
  blockers?: string[]
  quality_bar?: string[] | string
  harnessDetail?: HarnessSummary | null
  resolved_team?: {
    id: string
    name: string
    description?: string
    lead_role?: string
    roles?: string[]
    coordination?: Record<string, unknown>
  } | null
}

export interface ApprovalQueueRecord extends Approval, TimestampedRecord {
  run?: {
    id: string
    status?: string
    current_phase?: string | null
  } | null
  playbook?: {
    id: string
    name: string
  } | null
}

export interface ArtifactRecord extends Artifact, TimestampedRecord {
  url?: string
  downloadUrl?: string
  summary?: string
}

export interface SessionRecord extends RunSession, TimestampedRecord {
  messages?: Array<Record<string, unknown>>
  history?: Array<Record<string, unknown>>
  events?: Array<Record<string, unknown>>
}

export type EventRecord = RunEventEnvelope | (Record<string, unknown> & {
  id?: string
  type?: string
  eventType?: string
  timestamp?: string
  occurredAt?: string
  message?: string
  payload?: unknown
})

export interface RunDetailResponse {
  run: RunRecord
  approvals: ApprovalQueueRecord[]
  artifacts: ArtifactRecord[]
  events: EventRecord[]
  sessions: SessionRecord[]
}

export interface RunCreateInput {
  playbookId: string
  harnessId: string
  inputs?: Record<string, unknown>
  teamId?: string
  provider?: string
  workingDirectory?: string
}

export interface PlaybookUpsertInput {
  kind: "playbook"
  name: string
  description: string
  goal: string
  instructions: string
  inputs?: InputSpec[]
  artifacts?: Playbook["artifacts"]
  quality_bar?: Playbook["quality_bar"]
  metadata?: Record<string, unknown>
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Request failed: ${res.status}`)
  }
  const body = await res.json()
  return body.data
}

export const api = {
  playbooks: {
    list: () => request<PlaybookRecord[]>("/playbooks"),
    get: (id: string) => request<PlaybookRecord>(`/playbooks/${id}`),
    create: (data: PlaybookUpsertInput) =>
      request<PlaybookRecord>("/playbooks", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: PlaybookUpsertInput) =>
      request<PlaybookRecord>(`/playbooks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  },
  harnesses: {
    list: () => request<HarnessSummary[]>("/harnesses"),
    get: (id: string) => request<HarnessSummary>(`/harnesses/${id}`),
    create: (data: Harness) => request<HarnessSummary>("/harnesses", { method: "POST", body: JSON.stringify(data) }),
    attach: (harnessId: string, playbookId: string) =>
      request<PlaybookRecord>(`/harnesses/${harnessId}/attach/${playbookId}`, { method: "POST" }),
  },
  runs: {
    list: () => request<RunRecord[]>("/runs"),
    get: (id: string) => request<RunDetailResponse>(`/runs/${id}`),
    create: (data: RunCreateInput) =>
      request<RunRecord>("/runs", { method: "POST", body: JSON.stringify(data) }),
    cancel: (id: string) => request<RunRecord>(`/runs/${id}/cancel`, { method: "POST" }),
  },
  approvals: {
    list: (status?: ApprovalStatus) =>
      request<ApprovalQueueRecord[]>(status ? `/approvals?status=${encodeURIComponent(status)}` : "/approvals"),
    listByRun: (runId: string) => request<ApprovalQueueRecord[]>(`/runs/${runId}/approvals`),
    resolve: (id: string, data: { decision: ApprovalDecision; note?: string }) =>
      request<ApprovalQueueRecord>(`/approvals/${id}/resolve`, { method: "POST", body: JSON.stringify(data) }),
  },
  artifacts: {
    listByRun: (runId: string) => request<ArtifactRecord[]>(`/runs/${runId}/artifacts`),
  },
  events: {
    listByRun: (runId: string) => request<EventRecord[]>(`/runs/${runId}/events`),
  },
}
