/**
 * Component Connection Experiment
 *
 * Verifies that the full service stack works with Postgres repositories:
 * - PlaybookService → PgPlaybookRepository → Postgres
 * - HarnessService → PgHarnessRepository → Postgres
 * - RunService → PgRunRepository + PgRunEventRepository + PgRunPlanRepository → Postgres
 * - ApprovalService → PgApprovalRepository → Postgres
 * - ArtifactService → PgArtifactRepository → Postgres
 *
 * This validates component-to-component connectivity with real Postgres.
 * Requires: docker compose up -d postgres-test
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
import { PlaybookService } from "../services/playbook-service.js"
import { HarnessService } from "../services/harness-service.js"
import { RunService } from "../services/run-service.js"
import { ApprovalService } from "../services/approval-service.js"
import { ArtifactService } from "../services/artifact-service.js"

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://pluto_test:pluto_test@localhost:5434/pluto_test"

let sql: ReturnType<typeof postgres>
let db: PostgresDatabase
let playbookService: PlaybookService
let harnessService: HarnessService
let runService: RunService
let approvalService: ApprovalService
let artifactService: ArtifactService

describe("Experiment: Full stack with Postgres", () => {
  beforeAll(() => {
    sql = postgres(TEST_DATABASE_URL, { max: 5 })
    db = drizzle(sql, { schema })

    const playbookRepo = new PostgresPlaybookRepository(db)
    const harnessRepo = new PostgresHarnessRepository(db)
    const runRepo = new PostgresRunRepository(db)
    const runEventRepo = new PostgresRunEventRepository(db)
    const runPlanRepo = new PostgresRunPlanRepository(db)
    const policySnapshotRepo = new PostgresPolicySnapshotRepository(db)
    const approvalRepo = new PostgresApprovalRepository(db)
    const artifactRepo = new PostgresArtifactRepository(db)

    playbookService = new PlaybookService(playbookRepo)
    harnessService = new HarnessService(harnessRepo, playbookRepo)

    artifactService = new ArtifactService(
      artifactRepo,
      runRepo,
      playbookRepo,
      runEventRepo,
    )

    runService = new RunService(
      playbookRepo,
      harnessRepo,
      runRepo,
      runEventRepo,
      runPlanRepo,
      policySnapshotRepo,
      artifactService,
    )

    approvalService = new ApprovalService(approvalRepo, runService, runEventRepo)
  })

  afterAll(async () => {
    await sql.end()
  })

  beforeEach(async () => {
    await sql`TRUNCATE TABLE run_events, artifacts, approval_tasks, run_sessions, policy_snapshots, run_plans, runs, playbooks, harnesses CASCADE`
  })

  it("creates playbook and harness, then wires them together", async () => {
    const playbook = await playbookService.create({
      name: "Postgres Test Playbook",
      description: "Test with real DB",
      goal: "Validate Postgres connectivity",
      instructions: "Run through all components",
    })

    const harness = await harnessService.create({
      name: "Postgres Test Harness",
      description: "Real harness",
      phases: ["init", "execute", "verify"],
      approvals: { destructive_write: "required" },
    })

    const attached = await harnessService.attachToPlaybook(harness.id, playbook.id)
    expect(attached.harnessId).toBe(harness.id)
    expect(attached.harness?.name).toBe(harness.name)
    expect(attached.harness?.phases).toEqual(["init", "execute", "verify"])
  })

  it("creates a run and verifies all Postgres records", async () => {
    const playbook = await playbookService.create({
      name: "Run Test",
      description: "Run creation with Postgres",
      goal: "Create and verify run",
      instructions: "Test run lifecycle",
      artifacts: [{ type: "test_output", format: "json" }],
    })

    const harness = await harnessService.create({
      name: "Run Harness",
      description: "Test",
      phases: ["work", "review"],
    })

    const run = await runService.create(playbook.id, harness.id, {
      environment: "test",
      iteration: 1,
    })

    expect(run.status).toBe("queued")
    expect(run.playbook).toBe(playbook.id)
    expect(run.input).toEqual({ environment: "test", iteration: 1 })
  })

  it("transitions run through full lifecycle in Postgres", async () => {
    const playbook = await playbookService.create({
      name: "Lifecycle",
      description: "Full lifecycle",
      goal: "Test transitions",
      instructions: "Go through all states",
    })

    const harness = await harnessService.create({
      name: "Lifecycle Harness",
      description: "Test",
      phases: ["start"],
    })

    let run = await runService.create(playbook.id, harness.id, {})
    expect(run.status).toBe("queued")

    run = await runService.transition(run.id, "initializing")
    expect(run.status).toBe("initializing")

    run = await runService.transition(run.id, "running")
    expect(run.status).toBe("running")

    run = await runService.transition(run.id, "succeeded")
    expect(run.status).toBe("succeeded")
  })

  it("creates approval, resolves it, and verifies in Postgres", async () => {
    const playbook = await playbookService.create({
      name: "Approval Test",
      description: "Test",
      goal: "Approval flow",
      instructions: "Create and resolve",
    })

    const harness = await harnessService.create({
      name: "Approval Harness",
      description: "Test",
      phases: ["review"],
      approvals: { destructive_write: "required" },
    })

    const run = await runService.create(playbook.id, harness.id, {})
    await runService.transition(run.id, "initializing")
    await runService.transition(run.id, "running")

    const approval = await approvalService.createApproval({
      runId: run.id,
      actionClass: "destructive_write",
      title: "Delete test branch",
      requestedBy: { source: "session" },
    })

    expect(approval.status).toBe("pending")

    const resolved = await approvalService.resolve(
      approval.id,
      "approved",
      "test-operator",
      "Looks good",
    )

    expect(resolved.status).toBe("approved")
    expect(resolved.resolution?.decision).toBe("approved")
    expect(resolved.resolution?.resolved_by).toBe("test-operator")
  })

  it("registers artifact and checks requirements in Postgres", async () => {
    const playbook = await playbookService.create({
      name: "Artifact Test",
      description: "Test",
      goal: "Artifact flow",
      instructions: "Register and check",
      artifacts: [{ type: "report", format: "pdf" }],
    })

    const harness = await harnessService.create({
      name: "Artifact Harness",
      description: "Test",
      phases: ["produce"],
    })

    const run = await runService.create(playbook.id, harness.id, {})
    await runService.transition(run.id, "initializing")
    await runService.transition(run.id, "running")

    // Before registering — should block
    const missingCheck = await artifactService.checkRequiredArtifacts(run.id)
    expect(missingCheck.missingTypes).toContain("report")

    // Register the artifact
    const artifact = await artifactService.register({
      runId: run.id,
      type: "report",
      title: "Test Report",
      format: "pdf",
    })

    expect(artifact.status).toBe("registered")

    // After registering — should pass
    const passCheck = await artifactService.checkRequiredArtifacts(run.id)
    expect(passCheck.missingTypes).toHaveLength(0)

    // Now should be able to succeed
    await runService.transition(run.id, "succeeded")
  })
})
