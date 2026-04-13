export type RunStatus =
  | "queued"
  | "initializing"
  | "running"
  | "blocked"
  | "waiting_approval"
  | "failing"
  | "failed"
  | "succeeded"
  | "canceled"
  | "archived"

export type StageStatus =
  | "pending"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped"

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "canceled"

export type ApprovalDecision = "approved" | "denied"

export type ApprovalActionClass =
  | "destructive_write"
  | "external_publish"
  | "sensitive_mcp_access"
  | "pr_creation"
  | "production_change"

export type ArtifactStatus =
  | "draft"
  | "created"
  | "registered"
  | "superseded"
  | "archived"

export type ApprovalPolicyValue = "required" | "optional" | "disabled" | "inherit"

export type EventSource = "system" | "orchestrator" | "session" | "operator" | "policy"

export interface InputSpec {
  name: string
  type: "string" | "number" | "boolean" | "object" | "array"
  required: boolean
  description?: string
  default?: unknown
  enum?: unknown[]
}

export interface PlaybookContext {
  mcp_servers?: string[]
  repositories?: string[]
  memory_packs?: string[]
}

export interface ArtifactExpectation {
  type: string
  format?: string
  description?: string
}

export interface TeamPreference {
  lead_role?: string
  preferred_roles?: string[]
  coordination_mode?: string
}

export interface Playbook {
  kind: "playbook"
  name: string
  description: string
  owner?: string
  version?: string | number
  inputs?: InputSpec[]
  goal: string
  instructions: string
  context?: PlaybookContext
  tools?: string[]
  skills?: string[]
  team?: TeamPreference
  artifacts?: ArtifactExpectation[]
  quality_bar?: string[]
  metadata?: Record<string, unknown>
}

export interface StatusModel {
  run?: RunStatus[]
  stage?: StageStatus[]
}

export interface TimeoutPolicy {
  total_minutes?: number
  per_phase?: Record<string, number>
  session_idle_minutes?: number
  approval_wait_minutes?: number
}

export interface RetryRule {
  max_attempts: number
  backoff: string
  retryable_errors?: string[]
}

export interface RequirementPolicy {
  evidence_links_required?: boolean
  artifact_registration_required?: boolean
  final_summary_required?: boolean
  review_before_publish?: boolean
  role_handoff_tracking_required?: boolean
}

export interface ObservabilityPolicy {
  event_log_required?: boolean
  stage_transitions_required?: boolean
  artifact_emission_required?: boolean
  role_activity_tracking?: boolean
  raw_tool_events_retention_days?: number
}

export interface Harness {
  kind: "harness"
  name: string
  description: string
  version?: string | number
  phases: string[]
  status_model?: StatusModel
  timeouts?: TimeoutPolicy
  retries?: Record<string, RetryRule>
  approvals?: Partial<Record<ApprovalActionClass, ApprovalPolicyValue>> & Record<string, ApprovalPolicyValue>
  requirements?: RequirementPolicy
  observability?: ObservabilityPolicy
  escalation?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface Run {
  kind: "run"
  id: string
  playbook: string
  harness: string
  environment?: string
  team?: string
  input: Record<string, unknown>
  status: RunStatus
  current_phase?: string
  failureReason?: string
  blockerReason?: string
}

export interface RunStage {
  id: string
  phase: string
  role?: string
  status: StageStatus
}

export interface RunPlan {
  kind: "run_plan"
  run_id: string
  current_phase?: string
  stages: RunStage[]
}

export interface EnvironmentSpec {
  kind: "environment"
  id: string
  name: string
  repositories?: string[]
  integrations?: string[]
  constraints?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface RunSession {
  kind: "run_session"
  id: string
  run_id: string
  session_id: string
  persistence_handle?: string
  role_id?: string
  provider?: string
  mode_id?: string
  status: string
}

export interface PolicySnapshot {
  kind: "policy_snapshot"
  run_id: string
  approvals?: Partial<Record<ApprovalActionClass, ApprovalPolicyValue>> & Record<string, ApprovalPolicyValue>
  timeouts?: TimeoutPolicy
  requirements?: RequirementPolicy
}

export interface Approval {
  kind: "approval"
  id: string
  run_id: string
  action_class: ApprovalActionClass
  title: string
  status: ApprovalStatus
  requested_by: {
    source: string
    session_id?: string
    role_id?: string
  }
  context?: {
    phase?: string
    stage_id?: string
    reason?: string
  }
  resolution?: {
    resolved_at: string
    resolved_by: string
    decision: ApprovalDecision
    note?: string
  } | null
  metadata?: Record<string, unknown>
}

export interface Artifact {
  kind: "artifact"
  id: string
  run_id: string
  type: string
  title?: string
  format?: string
  producer?: {
    role_id?: string
    session_id?: string
  }
  storage?: {
    kind: "file" | "object_store" | "inline" | string
    uri: string
  }
  status: ArtifactStatus
  metadata?: Record<string, unknown>
}

export interface RoleSpec {
  kind: "role"
  id: string
  name: string
  description: string
  system_prompt?: string
  tools?: string[]
  provider_preset?: string
  memory_scope?: string
  isolation?: string
  background?: boolean
  hooks?: Record<string, unknown>[]
  metadata?: Record<string, unknown>
}

export interface TeamSpec {
  kind: "team"
  id: string
  name: string
  description: string
  lead_role?: string
  roles: string[]
  coordination?: {
    mode: "supervisor-led" | "shared-room" | "pipeline" | "committee" | string
    shared_room?: boolean
    heartbeat_minutes?: number
  }
  memory_scope?: "run" | "team" | "project" | "org" | string
  worktree_policy?: "shared" | "per-run" | "per-role" | string
  metadata?: Record<string, unknown>
}

export interface RunEventEnvelope<TPayload = unknown> {
  id: string
  runId: string
  eventType: string
  occurredAt: string
  source: EventSource
  phase?: string | null
  stageId?: string | null
  sessionId?: string | null
  roleId?: string | null
  payload: TPayload
  traceId?: string
  correlationId?: string
}

export * from "./validation.js"
