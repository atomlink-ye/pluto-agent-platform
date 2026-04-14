import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  InMemoryRoleSpecRepository,
  InMemoryTeamSpecRepository,
  RoleService,
  TeamService,
} from "@pluto-agent-platform/control-plane"

import {
  closeLiveE2EDockerTestContext,
  getLiveE2EDockerTestContext,
  resetLiveE2EDockerDatabase,
  type LiveE2EDockerTestContext,
} from "../../../control-plane/src/__tests__/e2e-docker/live-setup.js"
import { createApp } from "../api/app.js"

const describeLiveApi = process.env.LIVE_AGENT_E2E === "1" ? describe : describe.skip

interface ApiResponse<T> {
  data: T
}

interface RunResponse {
  id: string
  playbook: string
  harness: string
  status: string
}

interface RunSessionResponse {
  session_id: string
  provider: string
  persistence_handle: string | null
}

interface RunDetailResponse {
  run: RunResponse
  sessions: RunSessionResponse[]
}

let context: LiveE2EDockerTestContext
let server: Server
let baseUrl = ""
let stopRuntimeAdapter: (() => void) | null = null
const roleRepository = new InMemoryRoleSpecRepository()
const teamRepository = new InMemoryTeamSpecRepository()
const roleService = new RoleService(roleRepository)
const teamService = new TeamService(teamRepository, roleRepository)

describeLiveApi("Operator API live OpenCode integration", () => {
  beforeAll(async () => {
    context = getLiveE2EDockerTestContext()

    const app = createApp({
      playbookService: context.playbookService,
      harnessService: context.harnessService,
      roleService,
      teamService,
      runService: context.runService,
      approvalService: context.approvalService,
      artifactService: context.artifactService,
      phaseController: context.phaseController,
      runCompiler: context.compiler,
      playbookRepository: context.playbookRepo,
      harnessRepository: context.harnessRepo,
      roleRepository,
      teamRepository,
      runRepository: context.runRepo,
      runEventRepository: context.runEventRepo,
      approvalRepository: context.approvalRepo,
      artifactRepository: context.artifactRepo,
      runSessionRepository: context.runSessionRepo,
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

  beforeEach(async () => {
    await resetLiveE2EDockerDatabase()
    stopRuntimeAdapter = context.runtimeAdapter.start()
  })

  afterEach(() => {
    stopRuntimeAdapter?.()
    stopRuntimeAdapter = null
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

    await closeLiveE2EDockerTestContext()
  })

  it("creates a run via POST /api/runs and returns an OpenCode persistence handle", async () => {
    stopRuntimeAdapter?.()
    stopRuntimeAdapter = null

    const playbook = await context.playbookService.create({
      name: "Live API Run Playbook",
      description: "Seeds the smallest live API run scenario",
      goal: "Create a live run through the platform API",
      instructions: "Acknowledge the request briefly.",
      artifacts: [],
    })

    const harness = await context.harnessService.create({
      name: "Live API Run Harness",
      description: "Single-phase harness for live API verification",
      phases: ["work"],
    })

    await context.harnessService.attachToPlaybook(harness.id, playbook.id)

    const createResponse = await postJson<RunResponse>("/api/runs", {
      playbookId: playbook.id,
      harnessId: harness.id,
      inputs: { topic: "live-api" },
      provider: "opencode",
      workingDirectory: process.cwd(),
    })

    expect(createResponse.response.status).toBe(201)

    const run = expectData(createResponse.body)
    expect(run).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        playbook: playbook.id,
        harness: harness.id,
        status: "running",
      }),
    )

    const detail = await waitFor(async () => {
      const detailResponse = await requestJson<RunDetailResponse>(`/api/runs/${run.id}`)
      const data = expectData(detailResponse.body)
      return data.sessions.length > 0 ? data : null
    })

    const [session] = detail.sessions
    expect(session).toEqual(
      expect.objectContaining({
        provider: "opencode",
        session_id: expect.any(String),
        persistence_handle: expect.any(String),
      }),
    )

    const runtimeResponse = await fetch(
      `${requiredEnv(process.env.OPENCODE_BASE_URL, "OPENCODE_BASE_URL")}/session/${session.persistence_handle}/message`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parts: [{ type: "text", text: "Reply with exactly: hi" }],
        }),
      },
    )

    expect(runtimeResponse.ok).toBe(true)

    const runtimeBody = (await runtimeResponse.json()) as unknown
    const normalizedModel = normalizeRuntimeValue(
      findStringValue(runtimeBody, ["model", "modelId", "modelID"]),
    )

    expect(normalizedModel).toContain("minimax")
    expect(normalizedModel).toContain("free")

    stopRuntimeAdapter?.()
    stopRuntimeAdapter = null
    await context.agentManager.killAgent(session.session_id)
  }, 60_000)
})

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: ApiResponse<T> | { error: string } }> {
  const response = await fetch(`${baseUrl}${path}`, init)
  const body = (await response.json()) as ApiResponse<T> | { error: string }

  return { response, body }
}

function postJson<T>(path: string, body: unknown) {
  return requestJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function expectData<T>(body: ApiResponse<T> | { error: string }): T {
  expect(body).toHaveProperty("data")
  return (body as ApiResponse<T>).data
}

async function waitFor<T>(
  producer: () => Promise<T | null> | T | null,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 30_000
  const intervalMs = options?.intervalMs ?? 100
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const value = await producer()
    if (value != null) {
      return value
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out after ${timeoutMs}ms`)
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required for live API tests`)
  }

  return value
}

function normalizeRuntimeValue(value: string | null): string {
  return value?.trim().toLowerCase() ?? ""
}

function findStringValue(value: unknown, fieldNames: string[]): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findStringValue(item, fieldNames)
      if (match != null) {
        return match
      }
    }

    return null
  }

  if (!isRecord(value)) {
    return null
  }

  for (const fieldName of fieldNames) {
    const directValue = value[fieldName]
    if (typeof directValue === "string" && directValue.length > 0) {
      return directValue
    }
  }

  for (const nestedValue of Object.values(value)) {
    const match = findStringValue(nestedValue, fieldNames)
    if (match != null) {
      return match
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
