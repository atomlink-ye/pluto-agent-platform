import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

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
  PostgresRoleSpecRepository,
  PostgresRunEventRepository,
  PostgresRunPlanRepository,
  PostgresRunRepository,
  PostgresRunSessionRepository,
  PostgresTeamSpecRepository,
  type PostgresDatabase,
} from "../../infrastructure/database/postgres-repositories.js"
import { PaseoAgentManager } from "../../paseo/paseo-agent-manager.js"
import { createControlPlaneMcpTools } from "../../mcp-tools/index.js"
import { ApprovalService } from "../../services/approval-service.js"
import { ArtifactService } from "../../services/artifact-service.js"
import { HarnessService } from "../../services/harness-service.js"
import { HandoffService } from "../../services/handoff-service.js"
import { PhaseController } from "../../services/phase-controller.js"
import { PlaybookService } from "../../services/playbook-service.js"
import { RecoveryService } from "../../services/recovery-service.js"
import { RoleService } from "../../services/role-service.js"
import { RunCompiler } from "../../services/run-compiler.js"
import { RunService } from "../../services/run-service.js"
import { RuntimeAdapter } from "../../services/runtime-adapter.js"
import { TeamService } from "../../services/team-service.js"
import { OpenCodeTestAgentClient } from "./opencode-test-client.js"

const DATABASE_URL = process.env.DATABASE_URL
const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL

const TRUNCATE_ALL_SQL =
  "TRUNCATE TABLE run_events, artifacts, approval_tasks, run_sessions, policy_snapshots, run_plans, runs, teams, roles, playbooks, harnesses CASCADE"

export interface LiveE2EDockerTestContext {
  sql: ReturnType<typeof postgres>
  db: PostgresDatabase
  playbookRepo: PostgresPlaybookRepository
  harnessRepo: PostgresHarnessRepository
  roleSpecRepo: PostgresRoleSpecRepository
  teamSpecRepo: PostgresTeamSpecRepository
  runRepo: PostgresRunRepository
  runEventRepo: PostgresRunEventRepository
  runPlanRepo: PostgresRunPlanRepository
  policySnapshotRepo: PostgresPolicySnapshotRepository
  approvalRepo: PostgresApprovalRepository
  artifactRepo: PostgresArtifactRepository
  runSessionRepo: PostgresRunSessionRepository
  playbookService: PlaybookService
  harnessService: HarnessService
  roleService: RoleService
  teamService: TeamService
  runService: RunService
  approvalService: ApprovalService
  artifactService: ArtifactService
  handoffService: HandoffService
  runtimeAdapter: RuntimeAdapter
  phaseController: PhaseController
  recoveryService: RecoveryService
  compiler: RunCompiler
  agentClient: OpenCodeTestAgentClient
  agentManager: PaseoAgentManager
  mcpBaseUrl: string
}

let context: LiveE2EDockerTestContext | null = null
let contextPromise: Promise<LiveE2EDockerTestContext> | null = null
let mcpServer: Server | null = null

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required for live Docker E2E tests`)
  }

  return value
}

export async function getLiveE2EDockerTestContext(): Promise<LiveE2EDockerTestContext> {
  if (context) {
    return context
  }

  if (contextPromise) {
    return contextPromise
  }

  contextPromise = createLiveE2EDockerTestContext().catch((error) => {
    contextPromise = null
    throw error
  })
  return contextPromise
}

async function createLiveE2EDockerTestContext(): Promise<LiveE2EDockerTestContext> {

  const databaseUrl = requireEnv(DATABASE_URL, "DATABASE_URL")
  const opencodeBaseUrl = requireEnv(OPENCODE_BASE_URL, "OPENCODE_BASE_URL")

  const sql = postgres(databaseUrl, { max: 5 })
  const db = drizzle(sql, { schema })

  const playbookRepo = new PostgresPlaybookRepository(db)
  const harnessRepo = new PostgresHarnessRepository(db)
  const roleSpecRepo = new PostgresRoleSpecRepository(db)
  const teamSpecRepo = new PostgresTeamSpecRepository(db)
  const runRepo = new PostgresRunRepository(db)
  const runEventRepo = new PostgresRunEventRepository(db)
  const runPlanRepo = new PostgresRunPlanRepository(db)
  const policySnapshotRepo = new PostgresPolicySnapshotRepository(db)
  const approvalRepo = new PostgresApprovalRepository(db)
  const artifactRepo = new PostgresArtifactRepository(db)
  const runSessionRepo = new PostgresRunSessionRepository(db)

  const playbookService = new PlaybookService(playbookRepo)
  const harnessService = new HarnessService(harnessRepo, playbookRepo)
  const roleService = new RoleService(roleSpecRepo)
  const teamService = new TeamService(teamSpecRepo, roleSpecRepo)
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
  const logger = createRootLogger({ level: "warn" })
  const kernelManager = new PaseoKernelAgentManager({
    clients: {
      opencode: agentClient,
    },
    logger,
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
  const handoffService = new HandoffService({
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    runPlanRepository: runPlanRepo,
    runSessionRepository: runSessionRepo,
    roleSpecRepository: roleSpecRepo,
    teamSpecRepository: teamSpecRepo,
    agentManager,
    runtimeAdapter,
  })
  const mcpTools = createControlPlaneMcpTools({
    phaseController,
    artifactService,
    handoffService,
  })
  mcpServer = createMcpServer(mcpTools.handlers)
  const mcpBaseUrl = await startServer(mcpServer)
  kernelManager.setMcpBaseUrl?.(mcpBaseUrl)
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
    roleSpecRepository: roleSpecRepo,
    teamSpecRepository: teamSpecRepo,
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
    roleSpecRepo,
    teamSpecRepo,
    runRepo,
    runEventRepo,
    runPlanRepo,
    policySnapshotRepo,
    approvalRepo,
    artifactRepo,
    runSessionRepo,
    playbookService,
    harnessService,
    roleService,
    teamService,
    runService,
    approvalService,
    artifactService,
    handoffService,
    runtimeAdapter,
    phaseController,
    recoveryService,
    compiler,
    agentClient,
    agentManager,
    mcpBaseUrl,
  }

  return context
}

export async function resetLiveE2EDockerDatabase(): Promise<void> {
  const currentContext = await getLiveE2EDockerTestContext()
  await currentContext.sql.unsafe(TRUNCATE_ALL_SQL)
}

export async function closeLiveE2EDockerTestContext(): Promise<void> {
  if (!context) {
    return
  }

  await Promise.allSettled([
    context.sql.end({ timeout: 5 }),
    closeServer(mcpServer),
  ])
  mcpServer = null
  context = null
  contextPromise = null
}

function startServer(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, () => {
      server.off("error", reject)
      const address = server.address()

      if (!address || typeof address === "string") {
        reject(new Error("Failed to start live MCP server"))
        return
      }

      resolve(`http://127.0.0.1:${(address as AddressInfo).port}/mcp`)
    })
  })
}

function closeServer(server: Server | null): Promise<void> {
  if (!server) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function createMcpServer(
  handlers: ReturnType<typeof createControlPlaneMcpTools>["handlers"],
): Server {
  const sessions = new Set<string>()

  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1")

    if (requestUrl.pathname !== "/mcp" || request.method !== "POST") {
      response.statusCode = 404
      response.end()
      return
    }

    try {
      const payload = await readJsonBody(request)
      const sessionId = request.headers["mcp-session-id"]

      if (isJsonRpcMethod(payload, "initialize")) {
        const createdSessionId = randomSessionId()
        sessions.add(createdSessionId)
        response.setHeader("content-type", "application/json")
        response.setHeader("mcp-session-id", createdSessionId)
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: {
            protocolVersion: payload.params?.protocolVersion ?? "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "pluto-control-plane-test", version: "0.1.0" },
          },
        }))
        return
      }

      if (typeof sessionId !== "string" || !sessions.has(sessionId)) {
        writeJsonRpcError(response, payload?.id ?? null, 404, "Session not found")
        return
      }

      if (isJsonRpcMethod(payload, "notifications/initialized")) {
        response.statusCode = 202
        response.end()
        return
      }

      if (!isJsonRpcMethod(payload, "tools/call")) {
        writeJsonRpcError(response, payload?.id ?? null, 400, "Unsupported MCP method")
        return
      }

      const toolName = payload.params?.name
      const input = payload.params?.arguments ?? {}
      const handler = typeof toolName === "string" && toolName in handlers
        ? handlers[toolName as keyof typeof handlers]
        : null

      if (!handler) {
        writeJsonRpcError(response, payload.id ?? null, 404, `Unknown tool: ${String(toolName)}`)
        return
      }

      const result = await handler(input)
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id ?? null,
        result: {
          structuredContent: normalizeStructuredContent(result),
        },
      }))
    } catch (error) {
      writeJsonRpcError(
        response,
        null,
        500,
        error instanceof Error ? error.message : "Internal MCP server error",
      )
    }
  })
}

function randomSessionId(): string {
  return `mcp_${Math.random().toString(36).slice(2)}`
}

function isJsonRpcMethod(
  payload: unknown,
  method: string,
): payload is { id?: string | number | null; method: string; params?: Record<string, unknown> } {
  return typeof payload === "object" && payload !== null && (payload as { method?: unknown }).method === method
}

function normalizeStructuredContent(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return JSON.parse(JSON.stringify(result)) as Record<string, unknown>
  }

  return { result: result ?? null }
}

function writeJsonRpcError(
  response: import("node:http").ServerResponse,
  id: string | number | null,
  statusCode: number,
  message: string,
): void {
  response.statusCode = statusCode
  response.setHeader("content-type", "application/json")
  response.end(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message,
    },
  }))
}

function readJsonBody(request: import("node:http").IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8")
        resolve(raw.length > 0 ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    request.on("error", reject)
  })
}
