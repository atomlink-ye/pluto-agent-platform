import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "../../infrastructure/database/schema.js"
import {
  PostgresApprovalRepository,
  PostgresArtifactRepository,
  PostgresHarnessRepository,
  PostgresPlaybookRepository,
  PostgresPolicySnapshotRepository,
  PostgresRunEventRepository,
  PostgresRunPlanRepository,
  PostgresRunRepository,
  PostgresRunSessionRepository,
  type PostgresDatabase,
} from "../../infrastructure/database/postgres-repositories.js"
import { FakeAgentManager } from "../../paseo/fake-agent-manager.js"
import { ApprovalService } from "../../services/approval-service.js"
import { ArtifactService } from "../../services/artifact-service.js"
import { HarnessService } from "../../services/harness-service.js"
import { PhaseController } from "../../services/phase-controller.js"
import { PlaybookService } from "../../services/playbook-service.js"
import { RecoveryService } from "../../services/recovery-service.js"
import { RunCompiler } from "../../services/run-compiler.js"
import { RunService } from "../../services/run-service.js"
import { RuntimeAdapter } from "../../services/runtime-adapter.js"

const DATABASE_URL = process.env.DATABASE_URL

const TRUNCATE_ALL_SQL =
  "TRUNCATE TABLE run_events, artifacts, approval_tasks, run_sessions, policy_snapshots, run_plans, runs, playbooks, harnesses CASCADE"

export interface E2EDockerTestContext {
  databaseUrl: string
  sql: ReturnType<typeof postgres>
  db: PostgresDatabase
  playbookRepo: PostgresPlaybookRepository
  harnessRepo: PostgresHarnessRepository
  runRepo: PostgresRunRepository
  runEventRepo: PostgresRunEventRepository
  runPlanRepo: PostgresRunPlanRepository
  policySnapshotRepo: PostgresPolicySnapshotRepository
  approvalRepo: PostgresApprovalRepository
  artifactRepo: PostgresArtifactRepository
  runSessionRepo: PostgresRunSessionRepository
  playbookService: PlaybookService
  harnessService: HarnessService
  runService: RunService
  approvalService: ApprovalService
  artifactService: ArtifactService
  runtimeAdapter: RuntimeAdapter
  phaseController: PhaseController
  recoveryService: RecoveryService
  compiler: RunCompiler
  agentManager: FakeAgentManager
}

let context: E2EDockerTestContext | null = null

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required for Docker E2E tests")
  }

  return DATABASE_URL
}

export function getE2EDockerTestContext(): E2EDockerTestContext {
  if (context) {
    return context
  }

  const databaseUrl = requireDatabaseUrl()
  const sql = postgres(databaseUrl, { max: 5 })
  const db = drizzle(sql, { schema })

  const playbookRepo = new PostgresPlaybookRepository(db)
  const harnessRepo = new PostgresHarnessRepository(db)
  const runRepo = new PostgresRunRepository(db)
  const runEventRepo = new PostgresRunEventRepository(db)
  const runPlanRepo = new PostgresRunPlanRepository(db)
  const policySnapshotRepo = new PostgresPolicySnapshotRepository(db)
  const approvalRepo = new PostgresApprovalRepository(db)
  const artifactRepo = new PostgresArtifactRepository(db)
  const runSessionRepo = new PostgresRunSessionRepository(db)

  const playbookService = new PlaybookService(playbookRepo)
  const harnessService = new HarnessService(harnessRepo, playbookRepo)
  const artifactService = new ArtifactService(artifactRepo, runRepo, playbookRepo, runEventRepo)
  const runService = new RunService(
    playbookRepo,
    harnessRepo,
    runRepo,
    runEventRepo,
    runPlanRepo,
    policySnapshotRepo,
    artifactService,
  )
  const approvalService = new ApprovalService(approvalRepo, runService, runEventRepo)
  const agentManager = new FakeAgentManager()
  const runtimeAdapter = new RuntimeAdapter(
    agentManager,
    runEventRepo,
    approvalRepo,
    runService,
    runSessionRepo,
  )
  const phaseController = new PhaseController({
    harnessRepository: harnessRepo,
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    approvalRepository: approvalRepo,
    runService,
    artifactChecker: artifactService,
    agentManager,
  })
  const recoveryService = new RecoveryService({
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    runSessionRepository: runSessionRepo,
    runService,
    runtimeAdapter,
    phaseController,
    agentManager,
  })
  const compiler = new RunCompiler({
    playbookRepository: playbookRepo,
    harnessRepository: harnessRepo,
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    runPlanRepository: runPlanRepo,
    policySnapshotRepository: policySnapshotRepo,
    runSessionRepository: runSessionRepo,
    runService,
    agentManager,
    runtimeAdapter,
  })

  context = {
    databaseUrl,
    sql,
    db,
    playbookRepo,
    harnessRepo,
    runRepo,
    runEventRepo,
    runPlanRepo,
    policySnapshotRepo,
    approvalRepo,
    artifactRepo,
    runSessionRepo,
    playbookService,
    harnessService,
    runService,
    approvalService,
    artifactService,
    runtimeAdapter,
    phaseController,
    recoveryService,
    compiler,
    agentManager,
  }

  return context
}

export async function resetE2EDockerDatabase(): Promise<void> {
  const currentContext = getE2EDockerTestContext()
  await currentContext.sql.unsafe(TRUNCATE_ALL_SQL)
}

export async function closeE2EDockerTestContext(): Promise<void> {
  if (!context) {
    return
  }

  await context.sql.end()
  context = null
}
