import type {
  Approval,
  Artifact,
  Harness,
  Playbook,
  PolicySnapshot,
  RunEventEnvelope,
  RunPlan,
  RunSession,
} from "@pluto-agent-platform/contracts"

import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"

const auditColumns = {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}

export const harnesses = pgTable(
  "harnesses",
  {
    ...auditColumns,
    tenantId: text("tenant_id"),
    publicId: text("public_id").notNull(),
    kind: text("kind").$type<Harness["kind"]>().notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    version: text("version"),
    versionKind: text("version_kind").$type<"string" | "number">(),
    phases: jsonb("phases").$type<Harness["phases"]>().notNull(),
    statusModel: jsonb("status_model").$type<Harness["status_model"]>(),
    timeouts: jsonb("timeouts").$type<Harness["timeouts"]>(),
    retries: jsonb("retries").$type<Harness["retries"]>(),
    approvals: jsonb("approvals").$type<Harness["approvals"]>(),
    requirements: jsonb("requirements").$type<Harness["requirements"]>(),
    observability: jsonb("observability").$type<Harness["observability"]>(),
    escalation: jsonb("escalation").$type<Harness["escalation"]>(),
    metadata: jsonb("metadata").$type<Harness["metadata"]>(),
  },
  (table) => [uniqueIndex("harnesses_public_id_idx").on(table.publicId)],
)

export const playbooks = pgTable(
  "playbooks",
  {
    ...auditColumns,
    tenantId: text("tenant_id"),
    publicId: text("public_id").notNull(),
    kind: text("kind").$type<Playbook["kind"]>().notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    owner: text("owner"),
    version: text("version"),
    versionKind: text("version_kind").$type<"string" | "number">(),
    harnessId: uuid("harness_id").references(() => harnesses.id, { onDelete: "set null" }),
    inputs: jsonb("inputs").$type<Playbook["inputs"]>(),
    goal: text("goal").notNull(),
    instructions: text("instructions").notNull(),
    context: jsonb("context").$type<Playbook["context"]>(),
    tools: jsonb("tools").$type<Playbook["tools"]>(),
    skills: jsonb("skills").$type<Playbook["skills"]>(),
    team: jsonb("team").$type<Playbook["team"]>(),
    artifacts: jsonb("artifacts").$type<Playbook["artifacts"]>(),
    qualityBar: jsonb("quality_bar").$type<Playbook["quality_bar"]>(),
    metadata: jsonb("metadata").$type<Playbook["metadata"]>(),
  },
  (table) => [uniqueIndex("playbooks_public_id_idx").on(table.publicId)],
)

export const runs = pgTable(
  "runs",
  {
    ...auditColumns,
    tenantId: text("tenant_id"),
    publicId: text("public_id").notNull(),
    kind: text("kind").$type<"run">().notNull(),
    playbookId: uuid("playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "restrict" }),
    harnessId: uuid("harness_id")
      .notNull()
      .references(() => harnesses.id, { onDelete: "restrict" }),
    environment: text("environment"),
    team: text("team"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull(),
    currentPhase: text("current_phase"),
    failureReason: text("failure_reason"),
    blockerReason: text("blocker_reason"),
  },
  (table) => [uniqueIndex("runs_public_id_idx").on(table.publicId)],
)

export const runPlans = pgTable(
  "run_plans",
  {
    ...auditColumns,
    tenantId: text("tenant_id"),
    kind: text("kind").$type<RunPlan["kind"]>().notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    currentPhase: text("current_phase"),
    stages: jsonb("stages").$type<RunPlan["stages"]>().notNull(),
  },
  (table) => [uniqueIndex("run_plans_run_id_idx").on(table.runId)],
)

export const runEvents = pgTable(
  "run_events",
  {
    ...auditColumns,
    tenantId: text("tenant_id"),
    publicId: text("public_id").notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    source: text("source").notNull(),
    phase: text("phase"),
    stageId: text("stage_id"),
    sessionId: text("session_id"),
    roleId: text("role_id"),
    traceId: text("trace_id"),
    correlationId: text("correlation_id"),
    payload: jsonb("payload").$type<RunEventEnvelope["payload"]>().notNull(),
  },
  (table) => [
    uniqueIndex("run_events_public_id_idx").on(table.publicId),
    index("run_events_run_id_occurred_at_idx").on(table.runId, table.occurredAt),
  ],
)

export const approvalTasks = pgTable(
  "approval_tasks",
  {
    ...auditColumns,
    tenantId: text("tenant_id"),
    publicId: text("public_id").notNull(),
    kind: text("kind").$type<Approval["kind"]>().notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    actionClass: text("action_class").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    requestedBy: jsonb("requested_by").$type<Approval["requested_by"]>().notNull(),
    context: jsonb("context").$type<Approval["context"]>(),
    resolution: jsonb("resolution").$type<Approval["resolution"]>(),
    metadata: jsonb("metadata").$type<Approval["metadata"]>(),
  },
  (table) => [uniqueIndex("approval_tasks_public_id_idx").on(table.publicId)],
)

export const artifacts = pgTable(
  "artifacts",
  {
    ...auditColumns,
    tenantId: text("tenant_id"),
    publicId: text("public_id").notNull(),
    kind: text("kind").$type<Artifact["kind"]>().notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title"),
    format: text("format"),
    producer: jsonb("producer").$type<Artifact["producer"]>(),
    storage: jsonb("storage").$type<Artifact["storage"]>(),
    status: text("status").notNull(),
    metadata: jsonb("metadata").$type<Artifact["metadata"]>(),
  },
  (table) => [uniqueIndex("artifacts_public_id_idx").on(table.publicId)],
)

export const runSessions = pgTable(
  "run_sessions",
  {
    ...auditColumns,
    tenantId: text("tenant_id"),
    publicId: text("public_id").notNull(),
    kind: text("kind").$type<RunSession["kind"]>().notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    persistenceHandle: text("persistence_handle"),
    roleId: text("role_id"),
    provider: text("provider"),
    modeId: text("mode_id"),
    status: text("status").notNull(),
  },
  (table) => [uniqueIndex("run_sessions_public_id_idx").on(table.publicId)],
)

export const policySnapshots = pgTable(
  "policy_snapshots",
  {
    ...auditColumns,
    tenantId: text("tenant_id"),
    kind: text("kind").$type<PolicySnapshot["kind"]>().notNull(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    approvals: jsonb("approvals").$type<PolicySnapshot["approvals"]>(),
    timeouts: jsonb("timeouts").$type<PolicySnapshot["timeouts"]>(),
    requirements: jsonb("requirements").$type<PolicySnapshot["requirements"]>(),
  },
  (table) => [uniqueIndex("policy_snapshots_run_id_idx").on(table.runId)],
)
