import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { AgentManager as PaseoKernelAgentManager, createRootLogger } from "@pluto-agent-platform/paseo"

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
import { PaseoAgentManager } from "../../paseo/paseo-agent-manager.js"
import { ApprovalService } from "../../services/approval-service.js"
import { ArtifactService } from "../../services/artifact-service.js"
import { HarnessService } from "../../services/harness-service.js"
import { PhaseController } from "../../services/phase-controller.js"
import { PlaybookService } from "../../services/playbook-service.js"
import { RecoveryService } from "../../services/recovery-service.js"
import { RunCompiler } from "../../services/run-compiler.js"
import { RunService } from "../../services/run-service.js"
import { RuntimeAdapter } from "../../services/runtime-adapter.js"
import { OpenCodeTestAgentClient } from "./opencode-test-client.js"

const DATABASE_URL = process.env.DATABASE_URL
const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL

const TRUNCATE_ALL_SQL =
  "TRUNCATE TABLE run_events, artifacts, approval_tasks, run_sessions, policy_snapshots, run_plans, runs, playbooks, harnesses CASCADE"

export interface LiveE2EDockerTestContext {
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
  agentClient: OpenCodeTestAgentClient
  agentManager: PaseoAgentManager
}

let context: LiveE2EDockerTestContext | null = null

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required for live Docker E2E tests`)
  }

  return value
}

export function getLiveE2EDockerTestContext(): LiveE2EDockerTestContext {
  if (context) {
    return context
  }

  const databaseUrl = requireEnv(DATABASE_URL, "DATABASE_URL")
  const opencodeBaseUrl = requireEnv(OPENCODE_BASE_URL, "OPENCODE_BASE_URL")

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
  const agentClient = new OpenCodeTestAgentClient(opencodeBaseUrl)
  const kernelManager = new PaseoKernelAgentManager({
    clients: {
      opencode: agentClient,
    },
    logger: createRootLogger({ level: "warn" }),
  })
  const agentManager = new PaseoAgentManager(kernelManager)
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
    phaseController,
  })

  context = {
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
    agentClient,
    agentManager,
  }

  return context
}

export async function resetLiveE2EDockerDatabase(): Promise<void> {
  const currentContext = getLiveE2EDockerTestContext()
  await currentContext.sql.unsafe(TRUNCATE_ALL_SQL)
}

export async function closeLiveE2EDockerTestContext(): Promise<void> {
  if (!context) {
    return
  }

  await context.sql.end()
  context = null
}
