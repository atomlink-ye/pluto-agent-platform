import { randomUUID } from "node:crypto"
import type {
  Playbook,
  Harness,
  Run,
  RunPlan,
  RunEventEnvelope,
  PolicySnapshot,
  Approval,
  Artifact,
  RunSession,
} from "@pluto-agent-platform/contracts"
import type {
  PlaybookRecord,
  HarnessRecord,
  RunRecord,
  ApprovalRecord,
  ArtifactRecord,
  RunSessionRecord,
} from "../../repositories.js"

const now = () => new Date().toISOString()

export function buildPlaybookRecord(
  overrides: Partial<PlaybookRecord> = {},
): PlaybookRecord {
  const id = `pb_${randomUUID()}`
  const ts = now()
  return {
    kind: "playbook",
    id,
    name: "Test Playbook",
    description: "A test playbook",
    goal: "Complete the test task",
    instructions: "Follow the test steps",
    createdAt: ts,
    updatedAt: ts,
    harnessId: null,
    harness: null,
    ...overrides,
  }
}

export function buildHarnessRecord(
  overrides: Partial<HarnessRecord> = {},
): HarnessRecord {
  const id = `hs_${randomUUID()}`
  const ts = now()
  return {
    kind: "harness",
    id,
    name: "Test Harness",
    description: "A test harness",
    phases: ["collect", "analyze", "review"],
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  }
}

export function buildRunRecord(
  overrides: Partial<RunRecord> = {},
): RunRecord {
  const id = `run_${randomUUID()}`
  const ts = now()
  return {
    kind: "run",
    id,
    playbook: `pb_${randomUUID()}`,
    harness: `hs_${randomUUID()}`,
    input: { topic: "test" },
    status: "queued",
    current_phase: "collect",
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  }
}

export function buildRunPlan(
  overrides: Partial<RunPlan> = {},
): RunPlan {
  return {
    kind: "run_plan",
    run_id: `run_${randomUUID()}`,
    current_phase: "collect",
    stages: [
      { id: `stg_${randomUUID()}`, phase: "collect", status: "pending" },
      { id: `stg_${randomUUID()}`, phase: "analyze", status: "pending" },
      { id: `stg_${randomUUID()}`, phase: "review", status: "pending" },
    ],
    ...overrides,
  }
}

export function buildRunEvent(
  overrides: Partial<RunEventEnvelope> = {},
): RunEventEnvelope {
  return {
    id: `evt_${randomUUID()}`,
    runId: `run_${randomUUID()}`,
    eventType: "run.created",
    occurredAt: now(),
    source: "system",
    payload: {},
    ...overrides,
  }
}

export function buildPolicySnapshot(
  overrides: Partial<PolicySnapshot> = {},
): PolicySnapshot {
  return {
    kind: "policy_snapshot",
    run_id: `run_${randomUUID()}`,
    approvals: { destructive_write: "required" },
    timeouts: { total_minutes: 60 },
    requirements: { artifact_registration_required: true },
    ...overrides,
  }
}

export function buildApprovalRecord(
  overrides: Partial<ApprovalRecord> = {},
): ApprovalRecord {
  const id = `appr_${randomUUID()}`
  const ts = now()
  return {
    kind: "approval",
    id,
    run_id: `run_${randomUUID()}`,
    action_class: "destructive_write",
    title: "Delete production branch",
    status: "pending",
    requested_by: { source: "session" },
    resolution: null,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  }
}

export function buildArtifactRecord(
  overrides: Partial<ArtifactRecord> = {},
): ArtifactRecord {
  const id = `art_${randomUUID()}`
  const ts = now()
  return {
    kind: "artifact",
    id,
    run_id: `run_${randomUUID()}`,
    type: "retro_document",
    title: "Sprint Retrospective",
    format: "markdown",
    status: "registered",
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  }
}

export function buildRunSessionRecord(
  overrides: Partial<RunSessionRecord> = {},
): RunSessionRecord {
  const id = `sess_${randomUUID()}`
  const ts = now()
  return {
    kind: "run_session",
    id,
    run_id: `run_${randomUUID()}`,
    session_id: `paseo_${randomUUID()}`,
    provider: "claude",
    status: "active",
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  }
}
