import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import {
  ApprovalService,
  ArtifactService,
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
  PlaybookService,
  RoleService,
  TeamService,
  RunService,
} from "@pluto-agent-platform/control-plane"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createApp } from "../api/app.js"

interface ApiResponse<T> {
  data: T
}

interface ErrorResponse {
  error: string
}

interface HarnessResponse {
  id: string
  kind: string
  name: string
  phases: string[]
}

interface HarnessSummary {
  id: string
  name: string
  phases: string[]
}

interface PlaybookResponse {
  id: string
  name: string
  goal: string
  instructions: string
  harnessId: string | null
  harness: HarnessSummary | null
}

interface RoleResponse {
  id: string
  kind: string
  name: string
  description: string
  tools?: string[]
  provider_preset?: string
}

interface TeamResponse {
  id: string
  kind: string
  name: string
  description: string
  lead_role: string
  roles: string[]
  coordination?: {
    mode: string
    shared_room?: boolean
    heartbeat_minutes?: number
  }
}

interface RunResponse {
  id: string
  playbook: string
  harness: string
  status: string
}

interface RunListItem extends RunResponse {
  playbookName: string
}

interface RunDetailResponse {
  run: RunResponse
  events: unknown[]
  approvals: unknown[]
  artifacts: unknown[]
}

interface ReferenceScenario {
  harness: HarnessResponse
  playbook: PlaybookResponse
}

let server: Server
let baseUrl = ""
let nextId = 0

const unique = (prefix: string): string => {
  nextId += 1
  return `${prefix}-${nextId}`
}

const requestJson = async <T>(
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: ApiResponse<T> | ErrorResponse }> => {
  const response = await fetch(`${baseUrl}${path}`, init)
  const body = (await response.json()) as ApiResponse<T> | ErrorResponse

  return { response, body }
}

const postJson = <T>(path: string, body: unknown) =>
  requestJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const expectData = <T>(body: ApiResponse<T> | ErrorResponse): T => {
  expect(body).toHaveProperty("data")
  return (body as ApiResponse<T>).data
}

const createHarness = async (): Promise<HarnessResponse> => {
  const suffix = unique("harness")
  const { response, body } = await postJson<HarnessResponse>("/api/harnesses", {
    name: `Governed review harness ${suffix}`,
    description: "Collect, analyze, and review with lightweight governance.",
    phases: ["collect", "analyze", "review"],
  })

  expect(response.status).toBe(201)
  return expectData(body)
}

const createPlaybook = async (): Promise<PlaybookResponse> => {
  const suffix = unique("playbook")
  const { response, body } = await postJson<PlaybookResponse>("/api/playbooks", {
    name: `Reference playbook ${suffix}`,
    description: "Prepare a concise reviewed summary for operators.",
    goal: "Turn collected inputs into a reviewed summary.",
    instructions: "Collect the source inputs, analyze them, and prepare the review package.",
    artifacts: [
      {
        type: "review_summary",
        format: "markdown",
        description: "Final reviewed summary artifact",
      },
    ],
  })

  expect(response.status).toBe(201)
  return expectData(body)
}

const attachHarness = async (harnessId: string, playbookId: string): Promise<PlaybookResponse> => {
  const { response, body } = await postJson<PlaybookResponse>(
    `/api/harnesses/${harnessId}/attach/${playbookId}`,
    {},
  )

  expect(response.status).toBe(200)
  return expectData(body)
}

const createReferenceScenario = async (): Promise<ReferenceScenario> => {
  const harness = await createHarness()
  const playbook = await createPlaybook()
  const attachedPlaybook = await attachHarness(harness.id, playbook.id)

  return { harness, playbook: attachedPlaybook }
}

const createRole = async (name: string, description: string): Promise<RoleResponse> => {
  const { response, body } = await postJson<RoleResponse>("/api/roles", {
    name,
    description,
  })

  expect(response.status).toBe(201)
  return expectData(body)
}

const createTeam = async (leadRole: string, roles: string[]): Promise<TeamResponse> => {
  const suffix = unique("team")
  const { response, body } = await postJson<TeamResponse>("/api/teams", {
    name: `Retro Team ${suffix}`,
    description: "Role set for preparing a sprint retrospective",
    lead_role: leadRole,
    roles,
  })

  expect(response.status).toBe(201)
  return expectData(body)
}

const createRun = async (playbookId: string, harnessId: string): Promise<RunResponse> => {
  const { response, body } = await postJson<RunResponse>("/api/runs", {
    playbookId,
    harnessId,
    inputs: {
      topic: unique("run"),
    },
  })

  expect(response.status).toBe(201)
  return expectData(body)
}

describe("Operator API integration", () => {
  beforeAll(async () => {
    // Repositories
    const playbookRepo = new InMemoryPlaybookRepository()
    const harnessRepo = new InMemoryHarnessRepository()
    const runRepo = new InMemoryRunRepository()
    const runEventRepo = new InMemoryRunEventRepository()
    const runPlanRepo = new InMemoryRunPlanRepository()
    const policySnapshotRepo = new InMemoryPolicySnapshotRepository()
    const approvalRepo = new InMemoryApprovalRepository()
    const artifactRepo = new InMemoryArtifactRepository()
    const runSessionRepo = new InMemoryRunSessionRepository()
    const roleRepo = new InMemoryRoleSpecRepository()
    const teamRepo = new InMemoryTeamSpecRepository()

    // Services
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

    const app = createApp({
      playbookService,
      harnessService,
      roleService,
      teamService,
      runService,
      approvalService,
      artifactService,
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

    server = createServer(app)

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve())
    })

    const address = server.address() as AddressInfo | null
    if (!address) {
      throw new Error("Server did not expose an address")
    }

    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  })

  it("creates a harness via POST /api/harnesses", async () => {
    const harness = await createHarness()

    expect(harness).toEqual(
      expect.objectContaining({
        kind: "harness",
        phases: ["collect", "analyze", "review"],
      }),
    )
  })

  it("creates a playbook via POST /api/playbooks", async () => {
    const playbook = await createPlaybook()

    expect(playbook).toEqual(
      expect.objectContaining({
        name: expect.stringContaining("Reference playbook"),
        goal: "Turn collected inputs into a reviewed summary.",
        instructions: "Collect the source inputs, analyze them, and prepare the review package.",
        harnessId: null,
        harness: null,
      }),
    )
  })

  it("creates and lists roles through /api/roles", async () => {
    const { response, body } = await postJson<RoleResponse>("/api/roles", {
      name: "Researcher",
      description: "Gathers information",
      tools: ["websearch"],
      provider_preset: "balanced",
    })

    expect(response.status).toBe(201)

    const role = expectData(body)
    expect(role).toEqual(
      expect.objectContaining({
        kind: "role",
        name: "Researcher",
        description: "Gathers information",
        tools: ["websearch"],
        provider_preset: "balanced",
      }),
    )

    const listResult = await requestJson<RoleResponse[]>("/api/roles")
    expect(listResult.response.status).toBe(200)
    expect(expectData(listResult.body)).toEqual(expect.arrayContaining([expect.objectContaining({ id: role.id })]))

    const detailResult = await requestJson<RoleResponse>(`/api/roles/${role.id}`)
    expect(detailResult.response.status).toBe(200)
    expect(expectData(detailResult.body)).toEqual(expect.objectContaining({ id: role.id }))
  })

  it("creates and lists teams through /api/teams", async () => {
    const researcher = await createRole("Researcher", "Gathers information")
    const analyst = await createRole("Analyst", "Synthesizes findings")

    const team = await createTeam(analyst.id, [researcher.id, analyst.id])

    expect(team).toEqual(
      expect.objectContaining({
        kind: "team",
        lead_role: analyst.id,
        roles: [researcher.id, analyst.id],
        coordination: { mode: "supervisor-led" },
      }),
    )

    const listResult = await requestJson<TeamResponse[]>("/api/teams")
    expect(listResult.response.status).toBe(200)
    expect(expectData(listResult.body)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: team.id })]),
    )

    const detailResult = await requestJson<TeamResponse>(`/api/teams/${team.id}`)
    expect(detailResult.response.status).toBe(200)
    expect(expectData(detailResult.body)).toEqual(expect.objectContaining({ id: team.id }))
  })

  it("attaches a harness via POST /api/harnesses/:id/attach/:playbookId", async () => {
    const harness = await createHarness()
    const playbook = await createPlaybook()
    const attachedPlaybook = await attachHarness(harness.id, playbook.id)

    expect(attachedPlaybook).toEqual(
      expect.objectContaining({
        id: playbook.id,
        harnessId: harness.id,
        harness: expect.objectContaining({
          id: harness.id,
          name: harness.name,
          phases: ["collect", "analyze", "review"],
        }),
      }),
    )
  })

  it("lists playbooks and returns playbook detail with intent and harness", async () => {
    const scenario = await createReferenceScenario()

    const listResult = await requestJson<PlaybookResponse[]>("/api/playbooks")
    expect(listResult.response.status).toBe(200)

    const listedPlaybook = expectData(listResult.body).find((playbook) => playbook.id === scenario.playbook.id)
    expect(listedPlaybook).toEqual(
      expect.objectContaining({
        id: scenario.playbook.id,
        harness: expect.objectContaining({
          id: scenario.harness.id,
          name: scenario.harness.name,
        }),
      }),
    )

    const detailResult = await requestJson<PlaybookResponse>(`/api/playbooks/${scenario.playbook.id}`)
    expect(detailResult.response.status).toBe(200)
    expect(expectData(detailResult.body)).toEqual(
      expect.objectContaining({
        id: scenario.playbook.id,
        goal: scenario.playbook.goal,
        instructions: scenario.playbook.instructions,
        harness: expect.objectContaining({ id: scenario.harness.id, name: scenario.harness.name }),
      }),
    )
  })

  it("creates a queued run via POST /api/runs", async () => {
    const scenario = await createReferenceScenario()
    const run = await createRun(scenario.playbook.id, scenario.harness.id)

    expect(run).toEqual(
      expect.objectContaining({
        playbook: scenario.playbook.id,
        harness: scenario.harness.id,
        status: "queued",
      }),
    )
  })

  it("lists runs with playbookName and returns run detail arrays", async () => {
    const scenario = await createReferenceScenario()
    const run = await createRun(scenario.playbook.id, scenario.harness.id)

    const listResult = await requestJson<RunListItem[]>("/api/runs")
    expect(listResult.response.status).toBe(200)

    const listedRun = expectData(listResult.body).find((entry) => entry.id === run.id)
    expect(listedRun).toEqual(
      expect.objectContaining({
        id: run.id,
        playbookName: scenario.playbook.name,
      }),
    )

    const detailResult = await requestJson<RunDetailResponse>(`/api/runs/${run.id}`)
    expect(detailResult.response.status).toBe(200)

    const detail = expectData(detailResult.body)
    expect(detail.run).toEqual(expect.objectContaining({ id: run.id, status: "queued" }))
    expect(Array.isArray(detail.events)).toBe(true)
    expect(Array.isArray(detail.approvals)).toBe(true)
    expect(Array.isArray(detail.artifacts)).toBe(true)
  })

  it("returns ok from GET /api/health", async () => {
    const response = await fetch(`${baseUrl}/api/health`)
    const body = (await response.json()) as { status: string }

    expect(response.status).toBe(200)
    expect(body).toEqual(expect.objectContaining({ status: "ok" }))
  })
})
