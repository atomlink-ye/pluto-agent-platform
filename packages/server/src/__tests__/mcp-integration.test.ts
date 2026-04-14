import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  ApprovalService,
  ArtifactService,
  FakeAgentManager,
  HarnessService,
  InMemoryApprovalRepository,
  InMemoryArtifactRepository,
  InMemoryHarnessRepository,
  InMemoryPlaybookRepository,
  InMemoryPolicySnapshotRepository,
  InMemoryRunEventRepository,
  InMemoryRunPlanRepository,
  InMemoryRunRepository,
  InMemoryRunSessionRepository,
  InMemoryRoleSpecRepository,
  InMemoryTeamSpecRepository,
  PhaseController,
  PlaybookService,
  RoleService,
  RunCompiler,
  RuntimeAdapter,
  TeamService,
  RunService,
} from "@pluto-agent-platform/control-plane"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createApp } from "../api/app.js"
import { mountControlPlaneMcpEndpoint, type MountedControlPlaneMcpEndpoint } from "../mcp/control-plane-mcp.js"

let server: Server
let baseUrl = ""
let client: Client
let transport: StreamableHTTPClientTransport
let mcpEndpoint: MountedControlPlaneMcpEndpoint

let playbookService: PlaybookService
let harnessService: HarnessService
let runService: RunService
let artifactService: ArtifactService
let approvalService: ApprovalService

let runRepo: InMemoryRunRepository
let runEventRepo: InMemoryRunEventRepository
let artifactRepo: InMemoryArtifactRepository
let approvalRepo: InMemoryApprovalRepository

beforeEach(async () => {
  const playbookRepo = new InMemoryPlaybookRepository()
  const harnessRepo = new InMemoryHarnessRepository()
  const roleRepo = new InMemoryRoleSpecRepository()
  const teamRepo = new InMemoryTeamSpecRepository()
  runRepo = new InMemoryRunRepository()
  runEventRepo = new InMemoryRunEventRepository()
  const runPlanRepo = new InMemoryRunPlanRepository()
  const policySnapshotRepo = new InMemoryPolicySnapshotRepository()
  approvalRepo = new InMemoryApprovalRepository()
  artifactRepo = new InMemoryArtifactRepository()
  const runSessionRepo = new InMemoryRunSessionRepository()

  playbookService = new PlaybookService(playbookRepo)
  harnessService = new HarnessService(harnessRepo, playbookRepo)
  const roleService = new RoleService(roleRepo)
  const teamService = new TeamService(teamRepo, roleRepo)
  artifactService = new ArtifactService(artifactRepo, runRepo, playbookRepo, runEventRepo)
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

  const app = createApp({
    playbookService,
    harnessService,
    roleService,
    teamService,
    runService,
    runCompiler,
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
  mcpEndpoint = mountControlPlaneMcpEndpoint(app, {
    phaseController,
    artifactService,
  })

  server = createServer(app)
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve())
  })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`

  client = new Client({ name: "server-mcp-test", version: "1.0.0" }, { capabilities: {} })
  transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`))
  await client.connect(transport)
})

afterEach(async () => {
  await Promise.allSettled([
    transport?.close(),
    mcpEndpoint?.close(),
    new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    }),
  ])
})

describe("Control-plane MCP endpoint", () => {
  it("accepts declare_phase over MCP and updates governed run state", async () => {
    const playbook = await playbookService.create({
      name: "MCP phase playbook",
      description: "Drive a phase transition through MCP",
      goal: "Reach review",
      instructions: "Use the control-plane tool.",
    })
    const harness = await harnessService.create({
      name: "MCP phase harness",
      description: "Has a gated final phase",
      phases: ["work", "review"],
      approvals: { destructive_write: "required" },
    })
    await harnessService.attachToPlaybook(harness.id, playbook.id)

    const createdRun = await runService.create(playbook.id, harness.id, { topic: "mcp-phase" })
    await runService.transition(createdRun.id, "initializing")
    const run = await runService.transition(createdRun.id, "running")

    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["declare_phase", "register_artifact"]),
    )

    await client.callTool({
      name: "declare_phase",
      arguments: {
        runId: run.id,
        phase: "review",
      },
    })

    const updatedRun = await runRepo.getById(run.id)
    const approvals = await approvalRepo.listByRunId(run.id)
    const events = await runEventRepo.listByRunId(run.id)

    expect(updatedRun?.current_phase).toBe("review")
    expect(updatedRun?.status).toBe("waiting_approval")
    expect(approvals).toHaveLength(1)
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["phase.entered", "approval.requested"]),
    )
  })

  it("accepts register_artifact over MCP and persists artifact metadata", async () => {
    const playbook = await playbookService.create({
      name: "MCP artifact playbook",
      description: "Registers an artifact through MCP",
      goal: "Capture governed output",
      instructions: "Use the control-plane tool.",
      artifacts: [{ type: "run_report", format: "json" }],
    })
    const harness = await harnessService.create({
      name: "MCP artifact harness",
      description: "Single phase harness",
      phases: ["work"],
    })
    await harnessService.attachToPlaybook(harness.id, playbook.id)

    const run = await runService.create(playbook.id, harness.id, { topic: "mcp-artifact" })

    await client.callTool({
      name: "register_artifact",
      arguments: {
        runId: run.id,
        type: "run_report",
        title: "Generated report",
        format: "json",
      },
    })

    const artifacts = await artifactRepo.listByRunId(run.id)
    const events = await runEventRepo.listByRunId(run.id)

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.type).toBe("run_report")
    expect(artifacts[0]?.title).toBe("Generated report")
    expect(events.map((event) => event.eventType)).toContain("artifact.registered")
  })
})
