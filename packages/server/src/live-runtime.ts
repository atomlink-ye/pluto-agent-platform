import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import {
  ArtifactService,
  ApprovalService,
  FakeAgentManager,
  HandoffService,
  HarnessService,
  PaseoAgentManager,
  PhaseController,
  PlaybookService,
  PostgresApprovalRepository,
  PostgresArtifactRepository,
  PostgresHarnessRepository,
  PostgresPlaybookRepository,
  PostgresPolicySnapshotRepository,
  PostgresRoleSpecRepository,
  PostgresRunEventRepository,
  PostgresRunPlanRepository,
  PostgresRunRepository,
  PostgresRunSessionRepository,
  PostgresTeamSpecRepository,
  RecoveryService,
  RoleService,
  RunCompiler,
  RunService,
  RuntimeAdapter,
  TeamService,
  type AgentManager,
  dbSchema,
} from "@pluto-agent-platform/control-plane"
import {
  AgentManager as PaseoKernelAgentManager,
  type AgentClient as PaseoAgentClient,
  ClaudeAgentClient,
  OpenCodeAgentClient,
  createRootLogger,
  type LogLevel,
} from "@pluto-agent-platform/paseo"

import { createApp } from "./api/app.js"
import { mountControlPlaneMcpEndpoint, type MountedControlPlaneMcpEndpoint } from "./mcp/control-plane-mcp.js"

export interface LiveRuntime {
  app: ReturnType<typeof createApp>
  close(): Promise<void>
}

export async function createLiveRuntime(env: NodeJS.ProcessEnv = process.env): Promise<LiveRuntime> {
  const databaseUrl = requireEnv(env.DATABASE_URL, "DATABASE_URL")
  const port = Number(env.PORT ?? 4000)
  const publicBaseUrl = trimTrailingSlash(
    env.CONTROL_PLANE_BASE_URL ?? `http://127.0.0.1:${port}`,
  )

  const sql = postgres(databaseUrl, { max: 5 })
  const db = drizzle(sql, { schema: dbSchema })

  const playbookRepo = new PostgresPlaybookRepository(db)
  const harnessRepo = new PostgresHarnessRepository(db)
  const roleRepo = new PostgresRoleSpecRepository(db)
  const teamRepo = new PostgresTeamSpecRepository(db)
  const runRepo = new PostgresRunRepository(db)
  const runEventRepo = new PostgresRunEventRepository(db)
  const runPlanRepo = new PostgresRunPlanRepository(db)
  const policySnapshotRepo = new PostgresPolicySnapshotRepository(db)
  const approvalRepo = new PostgresApprovalRepository(db)
  const artifactRepo = new PostgresArtifactRepository(db)
  const runSessionRepo = new PostgresRunSessionRepository(db)

  const playbookService = new PlaybookService(playbookRepo)
  const harnessService = new HarnessService(harnessRepo, playbookRepo)
  const roleService = new RoleService(roleRepo)
  const teamService = new TeamService(teamRepo, roleRepo)
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
  const agentManager = createAgentManager(env, `${publicBaseUrl}/mcp`)
  const phaseController = new PhaseController({
    harnessRepository: harnessRepo,
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    approvalRepository: approvalRepo,
    runService,
    artifactChecker: artifactService,
    agentManager,
  })
  const runtimeAdapter = new RuntimeAdapter(
    agentManager,
    runEventRepo,
    approvalRepo,
    runService,
    runSessionRepo,
  )
  const handoffService = new HandoffService({
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    runPlanRepository: runPlanRepo,
    runSessionRepository: runSessionRepo,
    roleSpecRepository: roleRepo,
    teamSpecRepository: teamRepo,
    agentManager,
    runtimeAdapter,
  })
  const runCompiler = new RunCompiler({
    playbookRepository: playbookRepo,
    harnessRepository: harnessRepo,
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    runPlanRepository: runPlanRepo,
    policySnapshotRepository: policySnapshotRepo,
    runSessionRepository: runSessionRepo,
    roleSpecRepository: roleRepo,
    teamSpecRepository: teamRepo,
    runService,
    agentManager,
    runtimeAdapter,
    phaseController,
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

  const stopRuntimeAdapter = runtimeAdapter.start()
  await recoveryService.recover()

  const app = createApp({
    playbookService,
    harnessService,
    roleService,
    teamService,
    runService,
    runCompiler,
    defaultRunProvider: env.DEFAULT_RUN_PROVIDER,
    approvalService,
    artifactService,
    phaseController,
    playbookRepository: playbookRepo,
    harnessRepository: harnessRepo,
    roleRepository: roleRepo,
    teamRepository: teamRepo,
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    approvalRepository: approvalRepo,
    artifactRepository: artifactRepo,
    runSessionRepository: runSessionRepo,
  })
  const mcpEndpoint = mountControlPlaneMcpEndpoint(app, {
    phaseController,
    artifactService,
    handoffService,
    recoveryService,
  })

  return {
    app,
    async close() {
      stopRuntimeAdapter()
      await closeRuntime(mcpEndpoint, sql)
    },
  }
}

function createAgentManager(env: NodeJS.ProcessEnv, mcpBaseUrl: string): AgentManager {
  if ((env.PASEO_MODE ?? "live") !== "live") {
    return new FakeAgentManager()
  }

  const logger = createRootLogger({ level: parseLogLevel(env.LOG_LEVEL) })
  const clients: Record<string, PaseoAgentClient> = {
    claude: new ClaudeAgentClient({ logger }),
  }

  if (typeof env.OPENCODE_BASE_URL === "string" && env.OPENCODE_BASE_URL.length > 0) {
    clients.opencode = new OpenCodeAgentClient({
      baseUrl: env.OPENCODE_BASE_URL,
      defaultModelId: env.OPENCODE_MODEL ?? "opencode/minimax-m2.5-free",
    })
  }

  const kernelManager = new PaseoKernelAgentManager({
    clients,
    logger,
    mcpBaseUrl,
  })

  return new PaseoAgentManager(kernelManager)
}

async function closeRuntime(
  mcpEndpoint: MountedControlPlaneMcpEndpoint,
  sql: ReturnType<typeof postgres>,
): Promise<void> {
  await Promise.allSettled([mcpEndpoint.close(), sql.end({ timeout: 1 })])
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function parseLogLevel(value: string | undefined): LogLevel | undefined {
  switch (value) {
    case undefined:
      return undefined
    case "fatal":
    case "error":
    case "warn":
    case "info":
    case "debug":
    case "trace":
      return value
    default:
      return undefined
  }
}
