/**
 * Plan 003 Feature 1: Database Foundation — Integration Tests
 *
 * Requires: docker compose up -d postgres-test
 * TEST_DATABASE_URL=postgres://pluto_test:pluto_test@localhost:5434/pluto_test
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import * as schema from "../infrastructure/database/schema.js"
import {
  PostgresPlaybookRepository,
  PostgresHarnessRepository,
  PostgresRunRepository,
  PostgresRunEventRepository,
  PostgresRunPlanRepository,
  PostgresPolicySnapshotRepository,
  PostgresApprovalRepository,
  PostgresArtifactRepository,
  PostgresRunSessionRepository,
  type PostgresDatabase,
} from "../infrastructure/database/postgres-repositories.js"
import {
  buildPlaybookRecord,
  buildHarnessRecord,
  buildRunRecord,
  buildRunPlan,
  buildRunEvent,
  buildPolicySnapshot,
  buildApprovalRecord,
  buildArtifactRecord,
  buildRunSessionRecord,
} from "./helpers/factories.js"

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://pluto_test:pluto_test@localhost:5434/pluto_test"

let sql: ReturnType<typeof postgres>
let db: PostgresDatabase
let playbookRepo: PostgresPlaybookRepository
let harnessRepo: PostgresHarnessRepository
let runRepo: PostgresRunRepository
let runEventRepo: PostgresRunEventRepository
let runPlanRepo: PostgresRunPlanRepository
let policySnapshotRepo: PostgresPolicySnapshotRepository
let approvalRepo: PostgresApprovalRepository
let artifactRepo: PostgresArtifactRepository
let runSessionRepo: PostgresRunSessionRepository

async function truncateAll() {
  await sql`TRUNCATE TABLE run_events, artifacts, approval_tasks, run_sessions, policy_snapshots, run_plans, runs, playbooks, harnesses CASCADE`
}

/** Helper: seed a playbook + harness + run for tests that need a valid run */
async function seedRun() {
  const harness = buildHarnessRecord()
  const savedHarness = await harnessRepo.save(harness)
  const playbook = buildPlaybookRecord({ harnessId: savedHarness.id })
  const savedPlaybook = await playbookRepo.save(playbook)
  const run = buildRunRecord({
    playbook: savedPlaybook.id,
    harness: savedHarness.id,
  })
  const savedRun = await runRepo.save(run)
  return { playbook: savedPlaybook, harness: savedHarness, run: savedRun }
}

describe("Database Foundation (Plan 003 F1)", () => {
  beforeAll(() => {
    sql = postgres(TEST_DATABASE_URL, { max: 5 })
    db = drizzle(sql, { schema })
    playbookRepo = new PostgresPlaybookRepository(db)
    harnessRepo = new PostgresHarnessRepository(db)
    runRepo = new PostgresRunRepository(db)
    runEventRepo = new PostgresRunEventRepository(db)
    runPlanRepo = new PostgresRunPlanRepository(db)
    policySnapshotRepo = new PostgresPolicySnapshotRepository(db)
    approvalRepo = new PostgresApprovalRepository(db)
    artifactRepo = new PostgresArtifactRepository(db)
    runSessionRepo = new PostgresRunSessionRepository(db)
  })

  afterAll(async () => {
    await sql.end()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  // -----------------------------------------------------------------------
  // Scenario 1.2: Referential integrity enforced
  // -----------------------------------------------------------------------
  describe("Scenario 1.2: Referential integrity", () => {
    it("inserting run with nonexistent playbook fails", async () => {
      const harness = buildHarnessRecord()
      await harnessRepo.save(harness)
      const run = buildRunRecord({ playbook: "pb_nonexistent", harness: harness.id })
      await expect(runRepo.save(run)).rejects.toThrow()
    })

    it("inserting run with nonexistent harness fails", async () => {
      const playbook = buildPlaybookRecord()
      await playbookRepo.save(playbook)
      const run = buildRunRecord({ playbook: playbook.id, harness: "hs_nonexistent" })
      await expect(runRepo.save(run)).rejects.toThrow()
    })

    it("inserting run event with nonexistent run fails", async () => {
      const event = buildRunEvent({ runId: "run_nonexistent" })
      await expect(runEventRepo.append(event)).rejects.toThrow()
    })

    it("inserting approval with nonexistent run fails", async () => {
      const approval = buildApprovalRecord({ run_id: "run_nonexistent" })
      await expect(approvalRepo.save(approval)).rejects.toThrow()
    })

    it("inserting artifact with nonexistent run fails", async () => {
      const artifact = buildArtifactRecord({ run_id: "run_nonexistent" })
      await expect(artifactRepo.save(artifact)).rejects.toThrow()
    })

    it("inserting run session with nonexistent run fails", async () => {
      const session = buildRunSessionRecord({ run_id: "run_nonexistent" })
      await expect(runSessionRepo.save(session)).rejects.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Scenario 1.3: Run events are append-only
  // -----------------------------------------------------------------------
  describe("Scenario 1.3: Run events are append-only", () => {
    it("RunEventRepository has no update method", () => {
      expect((runEventRepo as unknown as Record<string, unknown>)["update"]).toBeUndefined()
    })

    it("RunEventRepository has no delete method", () => {
      expect((runEventRepo as unknown as Record<string, unknown>)["delete"]).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // Scenario 1.4: All tables round-trip correctly
  // -----------------------------------------------------------------------
  describe("Scenario 1.4: Round-trip", () => {
    it("harness record round-trips", async () => {
      const harness = buildHarnessRecord({
        approvals: { destructive_write: "required" },
        timeouts: { total_minutes: 60 },
      })
      const saved = await harnessRepo.save(harness)
      const fetched = await harnessRepo.getById(saved.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.name).toBe(harness.name)
      expect(fetched!.phases).toEqual(harness.phases)
      expect(fetched!.approvals).toEqual(harness.approvals)
    })

    it("playbook record round-trips", async () => {
      const playbook = buildPlaybookRecord({
        inputs: [{ name: "topic", type: "string", required: true }],
        quality_bar: ["completeness", "clarity"],
      })
      const saved = await playbookRepo.save(playbook)
      const fetched = await playbookRepo.getById(saved.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.name).toBe(playbook.name)
      expect(fetched!.goal).toBe(playbook.goal)
      expect(fetched!.inputs).toEqual(playbook.inputs)
      expect(fetched!.quality_bar).toEqual(playbook.quality_bar)
    })

    it("run record round-trips", async () => {
      const { run } = await seedRun()
      const fetched = await runRepo.getById(run.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.status).toBe("queued")
      expect(fetched!.input).toEqual(run.input)
    })

    it("run plan round-trips", async () => {
      const { run } = await seedRun()
      const plan = buildRunPlan({ run_id: run.id })
      const saved = await runPlanRepo.save(plan)
      const fetched = await runPlanRepo.getByRunId(run.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.stages).toEqual(plan.stages)
    })

    it("run event round-trips", async () => {
      const { run } = await seedRun()
      const event = buildRunEvent({
        runId: run.id,
        eventType: "run.created",
        payload: { status: "queued" },
      })
      await runEventRepo.append(event)
      const events = await runEventRepo.listByRunId(run.id)
      expect(events).toHaveLength(1)
      expect(events[0].eventType).toBe("run.created")
      expect(events[0].payload).toEqual({ status: "queued" })
    })

    it("policy snapshot round-trips", async () => {
      const { run } = await seedRun()
      const snapshot = buildPolicySnapshot({
        run_id: run.id,
        approvals: { destructive_write: "required" },
      })
      await policySnapshotRepo.save(snapshot)
      const fetched = await policySnapshotRepo.getByRunId(run.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.approvals).toEqual(snapshot.approvals)
    })

    it("approval record round-trips", async () => {
      const { run } = await seedRun()
      const approval = buildApprovalRecord({ run_id: run.id })
      const saved = await approvalRepo.save(approval)
      const fetched = await approvalRepo.getById(saved.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.action_class).toBe(approval.action_class)
      expect(fetched!.status).toBe("pending")
    })

    it("artifact record round-trips", async () => {
      const { run } = await seedRun()
      const artifact = buildArtifactRecord({
        run_id: run.id,
        producer: { role_id: "lead", session_id: "sess_1" },
      })
      const saved = await artifactRepo.save(artifact)
      const fetched = await artifactRepo.getById(saved.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.type).toBe(artifact.type)
      expect(fetched!.producer).toEqual(artifact.producer)
    })

    it("run session record round-trips", async () => {
      const { run } = await seedRun()
      const session = buildRunSessionRecord({ run_id: run.id })
      const saved = await runSessionRepo.save(session)
      const fetched = await runSessionRepo.getById(saved.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.provider).toBe(session.provider)
      expect(fetched!.status).toBe("active")
    })
  })

  // -----------------------------------------------------------------------
  // Additional: Query operations
  // -----------------------------------------------------------------------
  describe("Query operations", () => {
    it("list playbooks returns all in created order", async () => {
      const h = buildHarnessRecord()
      await harnessRepo.save(h)
      const p1 = buildPlaybookRecord({ name: "First" })
      const p2 = buildPlaybookRecord({ name: "Second" })
      await playbookRepo.save(p1)
      await playbookRepo.save(p2)
      const list = await playbookRepo.list()
      expect(list).toHaveLength(2)
      expect(list[0].name).toBe("First")
      expect(list[1].name).toBe("Second")
    })

    it("list run events returns chronological order", async () => {
      const { run } = await seedRun()
      const e1 = buildRunEvent({
        runId: run.id,
        eventType: "run.created",
        occurredAt: "2024-01-01T00:00:00Z",
      })
      const e2 = buildRunEvent({
        runId: run.id,
        eventType: "run.started",
        occurredAt: "2024-01-01T00:01:00Z",
      })
      await runEventRepo.append(e1)
      await runEventRepo.append(e2)
      const events = await runEventRepo.listByRunId(run.id)
      expect(events).toHaveLength(2)
      expect(events[0].eventType).toBe("run.created")
      expect(events[1].eventType).toBe("run.started")
    })

    it("list approvals by runId returns correct approvals", async () => {
      const { run } = await seedRun()
      const a1 = buildApprovalRecord({ run_id: run.id, title: "Approval 1" })
      const a2 = buildApprovalRecord({ run_id: run.id, title: "Approval 2" })
      await approvalRepo.save(a1)
      await approvalRepo.save(a2)
      const list = await approvalRepo.listByRunId(run.id)
      expect(list).toHaveLength(2)
    })

    it("list artifacts by runId returns correct artifacts", async () => {
      const { run } = await seedRun()
      const art = buildArtifactRecord({ run_id: run.id })
      await artifactRepo.save(art)
      const list = await artifactRepo.listByRunId(run.id)
      expect(list).toHaveLength(1)
    })

    it("list run sessions by runId returns correct sessions", async () => {
      const { run } = await seedRun()
      const s1 = buildRunSessionRecord({ run_id: run.id })
      const s2 = buildRunSessionRecord({ run_id: run.id })
      await runSessionRepo.save(s1)
      await runSessionRepo.save(s2)
      const list = await runSessionRepo.listByRunId(run.id)
      expect(list).toHaveLength(2)
    })

    it("update playbook works correctly", async () => {
      const playbook = buildPlaybookRecord({ name: "Original" })
      const saved = await playbookRepo.save(playbook)
      saved.name = "Updated"
      const updated = await playbookRepo.update(saved)
      expect(updated.name).toBe("Updated")
    })

    it("update run status works correctly", async () => {
      const { run } = await seedRun()
      run.status = "running"
      const updated = await runRepo.update(run)
      expect(updated.status).toBe("running")
    })

    it("update approval resolution works correctly", async () => {
      const { run } = await seedRun()
      const approval = buildApprovalRecord({ run_id: run.id })
      const saved = await approvalRepo.save(approval)
      saved.status = "approved"
      saved.resolution = {
        resolved_at: new Date().toISOString(),
        resolved_by: "operator",
        decision: "approved",
      }
      const updated = await approvalRepo.update(saved)
      expect(updated.status).toBe("approved")
      expect(updated.resolution?.decision).toBe("approved")
    })
  })
})
