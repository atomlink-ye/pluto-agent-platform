import type {
  Approval,
  Artifact,
  Harness,
  Playbook,
  PolicySnapshot,
  RoleSpec,
  TeamSpec,
  Run,
  RunEventEnvelope,
  RunPlan,
  RunSession,
} from "@pluto-agent-platform/contracts"

import { asc, eq, sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"

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
} from "../../repositories.js"
import {
  approvalTasks,
  artifacts,
  harnesses,
  playbooks,
  policySnapshots,
  roles,
  teams,
  runEvents,
  runPlans,
  runs,
  runSessions,
} from "./schema.js"

import * as schema from "./schema.js"

export type PostgresDatabase = PostgresJsDatabase<typeof schema>

type HarnessRow = typeof harnesses.$inferSelect
type PlaybookRow = typeof playbooks.$inferSelect
type RoleRow = typeof roles.$inferSelect
type TeamRow = typeof teams.$inferSelect
type RunRow = typeof runs.$inferSelect
type RunPlanRow = typeof runPlans.$inferSelect
type RunEventRow = typeof runEvents.$inferSelect
type ApprovalRow = typeof approvalTasks.$inferSelect
type ArtifactRow = typeof artifacts.$inferSelect
type RunSessionRow = typeof runSessions.$inferSelect
type PolicySnapshotRow = typeof policySnapshots.$inferSelect

const clone = <T>(value: T): T => structuredClone(value)

const toStoredVersion = (
  value: string | number | undefined,
): { version: string | undefined; versionKind: "string" | "number" | undefined } => {
  if (value === undefined) {
    return {
      version: undefined,
      versionKind: undefined,
    }
  }

  return {
    version: String(value),
    versionKind: typeof value === "number" ? "number" : "string",
  }
}

const fromStoredVersion = (
  value: string | null,
  kind: "string" | "number" | null,
): string | number | undefined => {
  if (value === null) {
    return undefined
  }

  return kind === "number" ? Number(value) : value
}

const toHarnessSummary = (row: HarnessRow) => ({
  id: row.publicId,
  name: row.name,
  description: row.description,
  phases: clone(row.phases),
})

const toPlaybookRecord = (row: PlaybookRow, harnessRow: HarnessRow | null): PlaybookRecord =>
  clone({
    id: row.publicId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    kind: row.kind,
    name: row.name,
    description: row.description,
    owner: row.owner ?? undefined,
    version: fromStoredVersion(row.version, row.versionKind),
    harnessId: harnessRow?.publicId ?? null,
    harness: harnessRow ? toHarnessSummary(harnessRow) : null,
    inputs: row.inputs ?? undefined,
    goal: row.goal,
    instructions: row.instructions,
    context: row.context ?? undefined,
    tools: row.tools ?? undefined,
    skills: row.skills ?? undefined,
    team: row.team ?? undefined,
    artifacts: row.artifacts ?? undefined,
    quality_bar: row.qualityBar ?? undefined,
    metadata: row.metadata ?? undefined,
  })

const toHarnessRecord = (row: HarnessRow): HarnessRecord =>
  clone({
    id: row.publicId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    kind: row.kind,
    name: row.name,
    description: row.description,
    version: fromStoredVersion(row.version, row.versionKind),
    phases: row.phases,
    status_model: row.statusModel ?? undefined,
    timeouts: row.timeouts ?? undefined,
    retries: row.retries ?? undefined,
    approvals: row.approvals ?? undefined,
    requirements: row.requirements ?? undefined,
    observability: row.observability ?? undefined,
    escalation: row.escalation ?? undefined,
    metadata: row.metadata ?? undefined,
  })

const toRoleSpecRecord = (row: RoleRow): RoleSpecRecord =>
  clone({
    id: row.publicId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    kind: row.kind,
    name: row.name,
    description: row.description,
    system_prompt: row.systemPrompt ?? undefined,
    tools: row.tools ?? undefined,
    provider_preset: row.providerPreset ?? undefined,
    memory_scope: row.memoryScope ?? undefined,
    isolation: row.isolation ?? undefined,
    background: row.background ?? undefined,
    hooks: row.hooks ?? undefined,
    metadata: row.metadata ?? undefined,
  })

const toTeamSpecRecord = (row: TeamRow): TeamSpecRecord =>
  clone({
    id: row.publicId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    kind: row.kind,
    name: row.name,
    description: row.description,
    lead_role: row.leadRole ?? undefined,
    roles: row.roles,
    coordination: row.coordination ?? undefined,
    memory_scope: row.memoryScope ?? undefined,
    worktree_policy: row.worktreePolicy ?? undefined,
    metadata: row.metadata ?? undefined,
  })

const toRunRecord = (row: RunRow, playbookPublicId: string, harnessPublicId: string): RunRecord =>
  clone({
    id: row.publicId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    kind: row.kind,
    playbook: playbookPublicId,
    harness: harnessPublicId,
    environment: row.environment ?? undefined,
    team: row.team ?? undefined,
    input: row.input,
    status: row.status as Run["status"],
    current_phase: row.currentPhase ?? undefined,
    failureReason: row.failureReason ?? undefined,
    blockerReason: row.blockerReason ?? undefined,
  })

const toRunPlan = (row: RunPlanRow, runPublicId: string): RunPlan =>
  clone({
    kind: row.kind,
    run_id: runPublicId,
    current_phase: row.currentPhase ?? undefined,
    stages: row.stages,
  })

const toRunEventEnvelope = (row: RunEventRow, runPublicId: string): RunEventEnvelope =>
  clone({
    id: row.publicId,
    runId: runPublicId,
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    source: row.source as RunEventEnvelope["source"],
    phase: row.phase ?? null,
    stageId: row.stageId ?? null,
    sessionId: row.sessionId ?? null,
    roleId: row.roleId ?? null,
    payload: row.payload,
    traceId: row.traceId ?? undefined,
    correlationId: row.correlationId ?? undefined,
  })

const toPolicySnapshot = (row: PolicySnapshotRow, runPublicId: string): PolicySnapshot =>
  clone({
    kind: row.kind,
    run_id: runPublicId,
    approvals: row.approvals ?? undefined,
    timeouts: row.timeouts ?? undefined,
    requirements: row.requirements ?? undefined,
  })

const toApprovalRecord = (row: ApprovalRow, runPublicId: string): ApprovalRecord =>
  clone({
    id: row.publicId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    kind: row.kind,
    run_id: runPublicId,
    action_class: row.actionClass as Approval["action_class"],
    title: row.title,
    status: row.status as Approval["status"],
    requested_by: row.requestedBy,
    context: row.context ?? undefined,
    resolution: row.resolution,
    metadata: row.metadata ?? undefined,
  })

const toArtifactRecord = (row: ArtifactRow, runPublicId: string): ArtifactRecord =>
  clone({
    id: row.publicId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    kind: row.kind,
    run_id: runPublicId,
    type: row.type,
    title: row.title ?? undefined,
    format: row.format ?? undefined,
    producer: row.producer ?? undefined,
    storage: row.storage ?? undefined,
    status: row.status as Artifact["status"],
    metadata: row.metadata ?? undefined,
  })

const toRunSessionRecord = (row: RunSessionRow, runPublicId: string): RunSessionRecord =>
  clone({
    id: row.publicId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    kind: row.kind,
    run_id: runPublicId,
    session_id: row.sessionId,
    persistence_handle: row.persistenceHandle ?? undefined,
    role_id: row.roleId ?? undefined,
    provider: row.provider ?? undefined,
    mode_id: row.modeId ?? undefined,
    status: row.status,
  })

abstract class PostgresRepositoryBase {
  constructor(protected readonly db: PostgresDatabase) {}

  protected async getHarnessRow(publicId: string): Promise<HarnessRow | null> {
    const [row] = await this.db.select().from(harnesses).where(eq(harnesses.publicId, publicId)).limit(1)

    return row ?? null
  }

  protected async requireHarnessRow(publicId: string): Promise<HarnessRow> {
    const row = await this.getHarnessRow(publicId)

    if (!row) {
      throw new Error(`Harness not found: ${publicId}`)
    }

    return row
  }

  protected async getPlaybookRow(publicId: string): Promise<PlaybookRow | null> {
    const [row] = await this.db.select().from(playbooks).where(eq(playbooks.publicId, publicId)).limit(1)

    return row ?? null
  }

  protected async requirePlaybookRow(publicId: string): Promise<PlaybookRow> {
    const row = await this.getPlaybookRow(publicId)

    if (!row) {
      throw new Error(`Playbook not found: ${publicId}`)
    }

    return row
  }

  protected async getRunRow(publicId: string): Promise<RunRow | null> {
    const [row] = await this.db.select().from(runs).where(eq(runs.publicId, publicId)).limit(1)

    return row ?? null
  }

  protected async requireRunRow(publicId: string): Promise<RunRow> {
    const row = await this.getRunRow(publicId)

    if (!row) {
      throw new Error(`Run not found: ${publicId}`)
    }

    return row
  }
}

export class PostgresPlaybookRepository extends PostgresRepositoryBase implements PlaybookRepository {
  async save(playbook: PlaybookRecord): Promise<PlaybookRecord> {
    const harnessRow = playbook.harnessId ? await this.requireHarnessRow(playbook.harnessId) : null
    const { version, versionKind } = toStoredVersion(playbook.version)

    await this.db
      .insert(playbooks)
      .values({
        publicId: playbook.id,
        createdAt: playbook.createdAt,
        updatedAt: playbook.updatedAt,
        kind: playbook.kind,
        name: playbook.name,
        description: playbook.description,
        owner: playbook.owner,
        version,
        versionKind,
        harnessId: harnessRow?.id ?? null,
        inputs: playbook.inputs,
        goal: playbook.goal,
        instructions: playbook.instructions,
        context: playbook.context,
        tools: playbook.tools,
        skills: playbook.skills,
        team: playbook.team,
        artifacts: playbook.artifacts,
        qualityBar: playbook.quality_bar,
        metadata: playbook.metadata,
      })
      .onConflictDoUpdate({
        target: playbooks.publicId,
        set: {
          createdAt: playbook.createdAt,
          updatedAt: playbook.updatedAt,
          kind: playbook.kind,
          name: playbook.name,
          description: playbook.description,
          owner: playbook.owner,
          version,
          versionKind,
          harnessId: harnessRow?.id ?? null,
          inputs: playbook.inputs,
          goal: playbook.goal,
          instructions: playbook.instructions,
          context: playbook.context,
          tools: playbook.tools,
          skills: playbook.skills,
          team: playbook.team,
          artifacts: playbook.artifacts,
          qualityBar: playbook.quality_bar,
          metadata: playbook.metadata,
        },
      })

    const saved = await this.getById(playbook.id)

    if (!saved) {
      throw new Error(`Playbook not found: ${playbook.id}`)
    }

    return saved
  }

  async getById(id: string): Promise<PlaybookRecord | null> {
    const [selection] = await this.db
      .select({
        playbook: playbooks,
        harness: harnesses,
      })
      .from(playbooks)
      .leftJoin(harnesses, eq(playbooks.harnessId, harnesses.id))
      .where(eq(playbooks.publicId, id))
      .limit(1)

    if (!selection) {
      return null
    }

    return toPlaybookRecord(selection.playbook, selection.harness)
  }

  async list(): Promise<PlaybookRecord[]> {
    const selections = await this.db
      .select({
        playbook: playbooks,
        harness: harnesses,
      })
      .from(playbooks)
      .leftJoin(harnesses, eq(playbooks.harnessId, harnesses.id))
      .orderBy(asc(playbooks.createdAt))

    return selections.map((selection) => toPlaybookRecord(selection.playbook, selection.harness))
  }

  async update(playbook: PlaybookRecord): Promise<PlaybookRecord> {
    const harnessRow = playbook.harnessId ? await this.requireHarnessRow(playbook.harnessId) : null
    const { version, versionKind } = toStoredVersion(playbook.version)

    const [updated] = await this.db
      .update(playbooks)
      .set({
        createdAt: playbook.createdAt,
        updatedAt: playbook.updatedAt,
        kind: playbook.kind,
        name: playbook.name,
        description: playbook.description,
        owner: playbook.owner,
        version,
        versionKind,
        harnessId: harnessRow?.id ?? null,
        inputs: playbook.inputs,
        goal: playbook.goal,
        instructions: playbook.instructions,
        context: playbook.context,
        tools: playbook.tools,
        skills: playbook.skills,
        team: playbook.team,
        artifacts: playbook.artifacts,
        qualityBar: playbook.quality_bar,
        metadata: playbook.metadata,
      })
      .where(eq(playbooks.publicId, playbook.id))
      .returning({ id: playbooks.id })

    if (!updated) {
      throw new Error(`Playbook not found: ${playbook.id}`)
    }

    const saved = await this.getById(playbook.id)

    if (!saved) {
      throw new Error(`Playbook not found: ${playbook.id}`)
    }

    return saved
  }
}

export class PostgresHarnessRepository extends PostgresRepositoryBase implements HarnessRepository {
  async save(harness: HarnessRecord): Promise<HarnessRecord> {
    const { version, versionKind } = toStoredVersion(harness.version)

    await this.db
      .insert(harnesses)
      .values({
        publicId: harness.id,
        createdAt: harness.createdAt,
        updatedAt: harness.updatedAt,
        kind: harness.kind,
        name: harness.name,
        description: harness.description,
        version,
        versionKind,
        phases: harness.phases,
        statusModel: harness.status_model,
        timeouts: harness.timeouts,
        retries: harness.retries,
        approvals: harness.approvals,
        requirements: harness.requirements,
        observability: harness.observability,
        escalation: harness.escalation,
        metadata: harness.metadata,
      })
      .onConflictDoUpdate({
        target: harnesses.publicId,
        set: {
          createdAt: harness.createdAt,
          updatedAt: harness.updatedAt,
          kind: harness.kind,
          name: harness.name,
          description: harness.description,
          version,
          versionKind,
          phases: harness.phases,
          statusModel: harness.status_model,
          timeouts: harness.timeouts,
          retries: harness.retries,
          approvals: harness.approvals,
          requirements: harness.requirements,
          observability: harness.observability,
          escalation: harness.escalation,
          metadata: harness.metadata,
        },
      })

    const saved = await this.getById(harness.id)

    if (!saved) {
      throw new Error(`Harness not found: ${harness.id}`)
    }

    return saved
  }

  async getById(id: string): Promise<HarnessRecord | null> {
    const row = await this.getHarnessRow(id)

    return row ? toHarnessRecord(row) : null
  }

  async list(): Promise<HarnessRecord[]> {
    const rows = await this.db.select().from(harnesses).orderBy(asc(harnesses.createdAt))

    return rows.map((row) => toHarnessRecord(row))
  }
}

export class PostgresRoleSpecRepository extends PostgresRepositoryBase implements RoleSpecRepository {
  async save(role: RoleSpecRecord): Promise<RoleSpecRecord> {
    await this.db
      .insert(roles)
      .values({
        publicId: role.id,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
        kind: role.kind,
        name: role.name,
        description: role.description,
        systemPrompt: role.system_prompt,
        tools: role.tools,
        providerPreset: role.provider_preset,
        memoryScope: role.memory_scope,
        isolation: role.isolation,
        background: role.background,
        hooks: role.hooks,
        metadata: role.metadata,
      })
      .onConflictDoUpdate({
        target: roles.publicId,
        set: {
          createdAt: role.createdAt,
          updatedAt: role.updatedAt,
          kind: role.kind,
          name: role.name,
          description: role.description,
          systemPrompt: role.system_prompt,
          tools: role.tools,
          providerPreset: role.provider_preset,
          memoryScope: role.memory_scope,
          isolation: role.isolation,
          background: role.background,
          hooks: role.hooks,
          metadata: role.metadata,
        },
      })

    const saved = await this.getById(role.id)

    if (!saved) {
      throw new Error(`RoleSpec not found: ${role.id}`)
    }

    return saved
  }

  async getById(id: string): Promise<RoleSpecRecord | null> {
    const [row] = await this.db.select().from(roles).where(eq(roles.publicId, id)).limit(1)

    return row ? toRoleSpecRecord(row) : null
  }

  async list(): Promise<RoleSpecRecord[]> {
    const rows = await this.db.select().from(roles).orderBy(asc(roles.createdAt))

    return rows.map((row) => toRoleSpecRecord(row))
  }

  async update(role: RoleSpecRecord): Promise<RoleSpecRecord> {
    const [updated] = await this.db
      .update(roles)
      .set({
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
        kind: role.kind,
        name: role.name,
        description: role.description,
        systemPrompt: role.system_prompt,
        tools: role.tools,
        providerPreset: role.provider_preset,
        memoryScope: role.memory_scope,
        isolation: role.isolation,
        background: role.background,
        hooks: role.hooks,
        metadata: role.metadata,
      })
      .where(eq(roles.publicId, role.id))
      .returning({ id: roles.id })

    if (!updated) {
      throw new Error(`RoleSpec not found: ${role.id}`)
    }

    const saved = await this.getById(role.id)

    if (!saved) {
      throw new Error(`RoleSpec not found: ${role.id}`)
    }

    return saved
  }
}

export class PostgresTeamSpecRepository extends PostgresRepositoryBase implements TeamSpecRepository {
  async save(team: TeamSpecRecord): Promise<TeamSpecRecord> {
    await this.db
      .insert(teams)
      .values({
        publicId: team.id,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
        kind: team.kind,
        name: team.name,
        description: team.description,
        leadRole: team.lead_role,
        roles: team.roles,
        coordination: team.coordination,
        memoryScope: team.memory_scope,
        worktreePolicy: team.worktree_policy,
        metadata: team.metadata,
      })
      .onConflictDoUpdate({
        target: teams.publicId,
        set: {
          createdAt: team.createdAt,
          updatedAt: team.updatedAt,
          kind: team.kind,
          name: team.name,
          description: team.description,
          leadRole: team.lead_role,
          roles: team.roles,
          coordination: team.coordination,
          memoryScope: team.memory_scope,
          worktreePolicy: team.worktree_policy,
          metadata: team.metadata,
        },
      })

    const saved = await this.getById(team.id)

    if (!saved) {
      throw new Error(`TeamSpec not found: ${team.id}`)
    }

    return saved
  }

  async getById(id: string): Promise<TeamSpecRecord | null> {
    const [row] = await this.db.select().from(teams).where(eq(teams.publicId, id)).limit(1)

    return row ? toTeamSpecRecord(row) : null
  }

  async list(): Promise<TeamSpecRecord[]> {
    const rows = await this.db.select().from(teams).orderBy(asc(teams.createdAt))

    return rows.map((row) => toTeamSpecRecord(row))
  }

  async update(team: TeamSpecRecord): Promise<TeamSpecRecord> {
    const [updated] = await this.db
      .update(teams)
      .set({
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
        kind: team.kind,
        name: team.name,
        description: team.description,
        leadRole: team.lead_role,
        roles: team.roles,
        coordination: team.coordination,
        memoryScope: team.memory_scope,
        worktreePolicy: team.worktree_policy,
        metadata: team.metadata,
      })
      .where(eq(teams.publicId, team.id))
      .returning({ id: teams.id })

    if (!updated) {
      throw new Error(`TeamSpec not found: ${team.id}`)
    }

    const saved = await this.getById(team.id)

    if (!saved) {
      throw new Error(`TeamSpec not found: ${team.id}`)
    }

    return saved
  }
}

export class PostgresRunRepository extends PostgresRepositoryBase implements RunRepository {
  async save(run: RunRecord): Promise<RunRecord> {
    const [playbookRow, harnessRow] = await Promise.all([
      this.requirePlaybookRow(run.playbook),
      this.requireHarnessRow(run.harness),
    ])

    await this.db
      .insert(runs)
      .values({
        publicId: run.id,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        kind: run.kind,
        playbookId: playbookRow.id,
        harnessId: harnessRow.id,
        environment: run.environment,
        team: run.team,
        input: run.input,
        status: run.status,
        currentPhase: run.current_phase,
        failureReason: run.failureReason,
        blockerReason: run.blockerReason,
      })
      .onConflictDoUpdate({
        target: runs.publicId,
        set: {
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          kind: run.kind,
          playbookId: playbookRow.id,
          harnessId: harnessRow.id,
          environment: run.environment,
          team: run.team,
          input: run.input,
          status: run.status,
          currentPhase: run.current_phase,
          failureReason: run.failureReason,
          blockerReason: run.blockerReason,
        },
      })

    const saved = await this.getById(run.id)

    if (!saved) {
      throw new Error(`Run not found: ${run.id}`)
    }

    return saved
  }

  async getById(id: string): Promise<RunRecord | null> {
    const [selection] = await this.db
      .select({
        run: runs,
        playbookPublicId: playbooks.publicId,
        harnessPublicId: harnesses.publicId,
      })
      .from(runs)
      .innerJoin(playbooks, eq(runs.playbookId, playbooks.id))
      .innerJoin(harnesses, eq(runs.harnessId, harnesses.id))
      .where(eq(runs.publicId, id))
      .limit(1)

    if (!selection) {
      return null
    }

    return toRunRecord(selection.run, selection.playbookPublicId, selection.harnessPublicId)
  }

  async list(): Promise<RunRecord[]> {
    const selections = await this.db
      .select({
        run: runs,
        playbookPublicId: playbooks.publicId,
        harnessPublicId: harnesses.publicId,
      })
      .from(runs)
      .innerJoin(playbooks, eq(runs.playbookId, playbooks.id))
      .innerJoin(harnesses, eq(runs.harnessId, harnesses.id))
      .orderBy(asc(runs.createdAt))

    return selections.map((s) => toRunRecord(s.run, s.playbookPublicId, s.harnessPublicId))
  }

  async update(run: RunRecord): Promise<RunRecord> {
    const [playbookRow, harnessRow] = await Promise.all([
      this.requirePlaybookRow(run.playbook),
      this.requireHarnessRow(run.harness),
    ])

    const [updated] = await this.db
      .update(runs)
      .set({
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        kind: run.kind,
        playbookId: playbookRow.id,
        harnessId: harnessRow.id,
        environment: run.environment,
        team: run.team,
        input: run.input,
        status: run.status,
        currentPhase: run.current_phase,
        failureReason: run.failureReason,
        blockerReason: run.blockerReason,
      })
      .where(eq(runs.publicId, run.id))
      .returning({ id: runs.id })

    if (!updated) {
      throw new Error(`Run not found: ${run.id}`)
    }

    const saved = await this.getById(run.id)

    if (!saved) {
      throw new Error(`Run not found: ${run.id}`)
    }

    return saved
  }
}

export class PostgresRunEventRepository extends PostgresRepositoryBase implements RunEventRepository {
  async append(event: RunEventEnvelope): Promise<RunEventEnvelope> {
    const runRow = await this.requireRunRow(event.runId)

    await this.db.insert(runEvents).values({
      publicId: event.id,
      runId: runRow.id,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      source: event.source,
      phase: event.phase ?? null,
      stageId: event.stageId ?? null,
      sessionId: event.sessionId ?? null,
      roleId: event.roleId ?? null,
      traceId: event.traceId,
      correlationId: event.correlationId,
      payload: event.payload,
    })

    return clone(event)
  }

  async listByRunId(runId: string): Promise<RunEventEnvelope[]> {
    const rows = await this.db
      .select({
        event: runEvents,
        runPublicId: runs.publicId,
      })
      .from(runEvents)
      .innerJoin(runs, eq(runEvents.runId, runs.id))
      .where(eq(runs.publicId, runId))
      .orderBy(asc(runEvents.occurredAt), asc(runEvents.createdAt))

    return rows.map((row) => toRunEventEnvelope(row.event, row.runPublicId))
  }
}

export class PostgresRunPlanRepository extends PostgresRepositoryBase implements RunPlanRepository {
  async save(runPlan: RunPlan): Promise<RunPlan> {
    const runRow = await this.requireRunRow(runPlan.run_id)

    await this.db
      .insert(runPlans)
      .values({
        kind: runPlan.kind,
        runId: runRow.id,
        currentPhase: runPlan.current_phase,
        stages: runPlan.stages,
      })
      .onConflictDoUpdate({
        target: runPlans.runId,
        set: {
          kind: runPlan.kind,
          currentPhase: runPlan.current_phase,
          stages: runPlan.stages,
          updatedAt: sql`now()`,
        },
      })

    const saved = await this.getByRunId(runPlan.run_id)

    if (!saved) {
      throw new Error(`Run not found: ${runPlan.run_id}`)
    }

    return saved
  }

  async getByRunId(runId: string): Promise<RunPlan | null> {
    const [selection] = await this.db
      .select({
        runPlan: runPlans,
        runPublicId: runs.publicId,
      })
      .from(runPlans)
      .innerJoin(runs, eq(runPlans.runId, runs.id))
      .where(eq(runs.publicId, runId))
      .limit(1)

    if (!selection) {
      return null
    }

    return toRunPlan(selection.runPlan, selection.runPublicId)
  }
}

export class PostgresPolicySnapshotRepository
  extends PostgresRepositoryBase
  implements PolicySnapshotRepository
{
  async save(policySnapshot: PolicySnapshot): Promise<PolicySnapshot> {
    const runRow = await this.requireRunRow(policySnapshot.run_id)

    await this.db
      .insert(policySnapshots)
      .values({
        kind: policySnapshot.kind,
        runId: runRow.id,
        approvals: policySnapshot.approvals,
        timeouts: policySnapshot.timeouts,
        requirements: policySnapshot.requirements,
      })
      .onConflictDoUpdate({
        target: policySnapshots.runId,
        set: {
          kind: policySnapshot.kind,
          approvals: policySnapshot.approvals,
          timeouts: policySnapshot.timeouts,
          requirements: policySnapshot.requirements,
          updatedAt: sql`now()`,
        },
      })

    const saved = await this.getByRunId(policySnapshot.run_id)

    if (!saved) {
      throw new Error(`Run not found: ${policySnapshot.run_id}`)
    }

    return saved
  }

  async getByRunId(runId: string): Promise<PolicySnapshot | null> {
    const [selection] = await this.db
      .select({
        policySnapshot: policySnapshots,
        runPublicId: runs.publicId,
      })
      .from(policySnapshots)
      .innerJoin(runs, eq(policySnapshots.runId, runs.id))
      .where(eq(runs.publicId, runId))
      .limit(1)

    if (!selection) {
      return null
    }

    return toPolicySnapshot(selection.policySnapshot, selection.runPublicId)
  }
}

export class PostgresApprovalRepository extends PostgresRepositoryBase implements ApprovalRepository {
  async save(approval: ApprovalRecord): Promise<ApprovalRecord> {
    const runRow = await this.requireRunRow(approval.run_id)

    await this.db
      .insert(approvalTasks)
      .values({
        publicId: approval.id,
        createdAt: approval.createdAt,
        updatedAt: approval.updatedAt,
        kind: approval.kind,
        runId: runRow.id,
        actionClass: approval.action_class,
        title: approval.title,
        status: approval.status,
        requestedBy: approval.requested_by,
        context: approval.context,
        resolution: approval.resolution,
        metadata: approval.metadata,
      })
      .onConflictDoUpdate({
        target: approvalTasks.publicId,
        set: {
          createdAt: approval.createdAt,
          updatedAt: approval.updatedAt,
          kind: approval.kind,
          runId: runRow.id,
          actionClass: approval.action_class,
          title: approval.title,
          status: approval.status,
          requestedBy: approval.requested_by,
          context: approval.context,
          resolution: approval.resolution,
          metadata: approval.metadata,
        },
      })

    const saved = await this.getById(approval.id)

    if (!saved) {
      throw new Error(`Approval not found: ${approval.id}`)
    }

    return saved
  }

  async getById(id: string): Promise<ApprovalRecord | null> {
    const [selection] = await this.db
      .select({
        approval: approvalTasks,
        runPublicId: runs.publicId,
      })
      .from(approvalTasks)
      .innerJoin(runs, eq(approvalTasks.runId, runs.id))
      .where(eq(approvalTasks.publicId, id))
      .limit(1)

    if (!selection) {
      return null
    }

    return toApprovalRecord(selection.approval, selection.runPublicId)
  }

  async list(): Promise<ApprovalRecord[]> {
    const rows = await this.db
      .select({
        approval: approvalTasks,
        runPublicId: runs.publicId,
      })
      .from(approvalTasks)
      .innerJoin(runs, eq(approvalTasks.runId, runs.id))
      .orderBy(asc(approvalTasks.createdAt))

    return rows.map((row) => toApprovalRecord(row.approval, row.runPublicId))
  }

  async listByRunId(runId: string): Promise<ApprovalRecord[]> {
    const rows = await this.db
      .select({
        approval: approvalTasks,
        runPublicId: runs.publicId,
      })
      .from(approvalTasks)
      .innerJoin(runs, eq(approvalTasks.runId, runs.id))
      .where(eq(runs.publicId, runId))
      .orderBy(asc(approvalTasks.createdAt))

    return rows.map((row) => toApprovalRecord(row.approval, row.runPublicId))
  }

  async update(approval: ApprovalRecord): Promise<ApprovalRecord> {
    const runRow = await this.requireRunRow(approval.run_id)

    const [updated] = await this.db
      .update(approvalTasks)
      .set({
        createdAt: approval.createdAt,
        updatedAt: approval.updatedAt,
        kind: approval.kind,
        runId: runRow.id,
        actionClass: approval.action_class,
        title: approval.title,
        status: approval.status,
        requestedBy: approval.requested_by,
        context: approval.context,
        resolution: approval.resolution,
        metadata: approval.metadata,
      })
      .where(eq(approvalTasks.publicId, approval.id))
      .returning({ id: approvalTasks.id })

    if (!updated) {
      throw new Error(`Approval not found: ${approval.id}`)
    }

    const saved = await this.getById(approval.id)

    if (!saved) {
      throw new Error(`Approval not found: ${approval.id}`)
    }

    return saved
  }
}

export class PostgresArtifactRepository extends PostgresRepositoryBase implements ArtifactRepository {
  async save(artifact: ArtifactRecord): Promise<ArtifactRecord> {
    const runRow = await this.requireRunRow(artifact.run_id)

    await this.db
      .insert(artifacts)
      .values({
        publicId: artifact.id,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
        kind: artifact.kind,
        runId: runRow.id,
        type: artifact.type,
        title: artifact.title,
        format: artifact.format,
        producer: artifact.producer,
        storage: artifact.storage,
        status: artifact.status,
        metadata: artifact.metadata,
      })
      .onConflictDoUpdate({
        target: artifacts.publicId,
        set: {
          createdAt: artifact.createdAt,
          updatedAt: artifact.updatedAt,
          kind: artifact.kind,
          runId: runRow.id,
          type: artifact.type,
          title: artifact.title,
          format: artifact.format,
          producer: artifact.producer,
          storage: artifact.storage,
          status: artifact.status,
          metadata: artifact.metadata,
        },
      })

    const saved = await this.getById(artifact.id)

    if (!saved) {
      throw new Error(`Artifact not found: ${artifact.id}`)
    }

    return saved
  }

  async getById(id: string): Promise<ArtifactRecord | null> {
    const [selection] = await this.db
      .select({
        artifact: artifacts,
        runPublicId: runs.publicId,
      })
      .from(artifacts)
      .innerJoin(runs, eq(artifacts.runId, runs.id))
      .where(eq(artifacts.publicId, id))
      .limit(1)

    if (!selection) {
      return null
    }

    return toArtifactRecord(selection.artifact, selection.runPublicId)
  }

  async listByRunId(runId: string): Promise<ArtifactRecord[]> {
    const rows = await this.db
      .select({
        artifact: artifacts,
        runPublicId: runs.publicId,
      })
      .from(artifacts)
      .innerJoin(runs, eq(artifacts.runId, runs.id))
      .where(eq(runs.publicId, runId))
      .orderBy(asc(artifacts.createdAt))

    return rows.map((row) => toArtifactRecord(row.artifact, row.runPublicId))
  }
}

export class PostgresRunSessionRepository extends PostgresRepositoryBase implements RunSessionRepository {
  async save(session: RunSessionRecord): Promise<RunSessionRecord> {
    const runRow = await this.requireRunRow(session.run_id)

    await this.db
      .insert(runSessions)
      .values({
        publicId: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        kind: session.kind,
        runId: runRow.id,
        sessionId: session.session_id,
        persistenceHandle: session.persistence_handle,
        roleId: session.role_id,
        provider: session.provider,
        modeId: session.mode_id,
        status: session.status,
      })
      .onConflictDoUpdate({
        target: runSessions.publicId,
        set: {
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          kind: session.kind,
          runId: runRow.id,
          sessionId: session.session_id,
          persistenceHandle: session.persistence_handle,
          roleId: session.role_id,
          provider: session.provider,
          modeId: session.mode_id,
          status: session.status,
        },
      })

    const saved = await this.getById(session.id)

    if (!saved) {
      throw new Error(`RunSession not found: ${session.id}`)
    }

    return saved
  }

  async getById(id: string): Promise<RunSessionRecord | null> {
    const [selection] = await this.db
      .select({
        session: runSessions,
        runPublicId: runs.publicId,
      })
      .from(runSessions)
      .innerJoin(runs, eq(runSessions.runId, runs.id))
      .where(eq(runSessions.publicId, id))
      .limit(1)

    if (!selection) {
      return null
    }

    return toRunSessionRecord(selection.session, selection.runPublicId)
  }

  async listByRunId(runId: string): Promise<RunSessionRecord[]> {
    const rows = await this.db
      .select({
        session: runSessions,
        runPublicId: runs.publicId,
      })
      .from(runSessions)
      .innerJoin(runs, eq(runSessions.runId, runs.id))
      .where(eq(runs.publicId, runId))
      .orderBy(asc(runSessions.createdAt))

    return rows.map((row) => toRunSessionRecord(row.session, row.runPublicId))
  }

  async update(session: RunSessionRecord): Promise<RunSessionRecord> {
    const runRow = await this.requireRunRow(session.run_id)

    const [updated] = await this.db
      .update(runSessions)
      .set({
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        kind: session.kind,
        runId: runRow.id,
        sessionId: session.session_id,
        persistenceHandle: session.persistence_handle,
        roleId: session.role_id,
        provider: session.provider,
        modeId: session.mode_id,
        status: session.status,
      })
      .where(eq(runSessions.publicId, session.id))
      .returning({ id: runSessions.id })

    if (!updated) {
      throw new Error(`RunSession not found: ${session.id}`)
    }

    const saved = await this.getById(session.id)

    if (!saved) {
      throw new Error(`RunSession not found: ${session.id}`)
    }

    return saved
  }
}
