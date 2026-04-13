import type { Server } from "node:http"
import type { AddressInfo } from "node:net"

import type { RunEventEnvelope } from "@pluto-agent-platform/contracts"
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
  PlaybookService,
  RunService,
  type ApprovalRecord,
  type ArtifactRecord,
  type HarnessRecord,
  type PlaybookRecord,
  type RunRecord,
} from "@pluto-agent-platform/control-plane"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createApp } from "../api/app.js"

interface ApiResponse<T> {
  data: T
}

interface ErrorResponse {
  error: string
}

interface RunDetailResponse {
  run: RunRecord
  events: RunEventEnvelope[]
  approvals: ApprovalRecord[]
  artifacts: ArtifactRecord[]
  sessions: unknown[]
}

interface TestContext {
  server: Server
  baseUrl: string
  runService: RunService
  approvalService: ApprovalService
  artifactService: ArtifactService
}

interface SeededReferenceScenario {
  harness: HarnessRecord
  playbook: PlaybookRecord
}

let ctx: TestContext | null = null

const createTestContext = async (): Promise<TestContext> => {
  const playbookRepository = new InMemoryPlaybookRepository()
  const harnessRepository = new InMemoryHarnessRepository()
  const runRepository = new InMemoryRunRepository()
  const runEventRepository = new InMemoryRunEventRepository()
  const runPlanRepository = new InMemoryRunPlanRepository()
  const policySnapshotRepository = new InMemoryPolicySnapshotRepository()
  const approvalRepository = new InMemoryApprovalRepository()
  const artifactRepository = new InMemoryArtifactRepository()
  const runSessionRepository = new InMemoryRunSessionRepository()

  const playbookService = new PlaybookService(playbookRepository)
  const harnessService = new HarnessService(harnessRepository, playbookRepository)
  const artifactService = new ArtifactService(
    artifactRepository,
    runRepository,
    playbookRepository,
    runEventRepository,
  )
  const runService = new RunService(
    playbookRepository,
    harnessRepository,
    runRepository,
    runEventRepository,
    runPlanRepository,
    policySnapshotRepository,
    artifactService,
  )
  const approvalService = new ApprovalService(approvalRepository, runService, runEventRepository)

  const app = createApp({
    playbookService,
    harnessService,
    runService,
    approvalService,
    artifactService,
    playbookRepository,
    harnessRepository,
    runRepository,
    runEventRepository,
    approvalRepository,
    artifactRepository,
    runSessionRepository,
  })

  const server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance))
  })
  const { port } = server.address() as AddressInfo

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    runService,
    approvalService,
    artifactService,
  }
}

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

const requestJson = async <T>(
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: ApiResponse<T> | ErrorResponse }> => {
  if (!ctx) {
    throw new Error("Test context not initialized")
  }

  const response = await fetch(`${ctx.baseUrl}${path}`, init)
  const body = (await response.json()) as ApiResponse<T> | ErrorResponse

  return { response, body }
}

const postJson = async <T>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ response: Response; body: ApiResponse<T> | ErrorResponse }> =>
  requestJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const expectData = <T>(body: ApiResponse<T> | ErrorResponse): T => {
  expect(body).toHaveProperty("data")
  return (body as ApiResponse<T>).data
}

const seedHarnessAndPlaybook = async (): Promise<SeededReferenceScenario> => {
  const harnessResult = await postJson<HarnessRecord>("/api/harnesses", {
    name: "Governed review harness",
    description: "Collect, analyze, and review with approval before review output",
    phases: ["collect", "analyze", "review"],
    approvals: {
      pr_creation: "required",
    },
  })

  expect(harnessResult.response.status).toBe(201)
  const harness = expectData(harnessResult.body)

  const playbookResult = await postJson<PlaybookRecord>("/api/playbooks", {
    name: "Sprint retrospective",
    description: "Prepare a governed retrospective outcome for operators",
    goal: "Turn sprint feedback into a reviewed retrospective artifact",
    instructions: "Collect sprint notes, analyze themes, and prepare the final review package.",
    inputs: [
      {
        name: "sprint_name",
        type: "string",
        required: true,
        description: "Sprint to review",
      },
      {
        name: "notes_url",
        type: "string",
        required: false,
        description: "Optional notes source",
      },
    ],
    artifacts: [
      {
        type: "retro_document",
        format: "markdown",
        description: "Final retrospective document",
      },
    ],
    quality_bar: ["clear synthesis", "actionable follow-ups"],
  })

  expect(playbookResult.response.status).toBe(201)
  const playbook = expectData(playbookResult.body)

  const attachResult = await postJson<PlaybookRecord>(
    `/api/harnesses/${harness.id}/attach/${playbook.id}`,
    {},
  )

  expect(attachResult.response.status).toBe(200)

  return {
    harness,
    playbook: expectData(attachResult.body),
  }
}

describe("Operator API integration", () => {
  beforeEach(async () => {
    ctx = await createTestContext()
  })

  afterEach(async () => {
    if (ctx) {
      await closeServer(ctx.server)
      ctx = null
    }
  })

  it("creates a harness via POST /api/harnesses", async () => {
    const { response, body } = await postJson<HarnessRecord>("/api/harnesses", {
      name: "Governed review harness",
      description: "Collect, analyze, and review with approval before review output",
      phases: ["collect", "analyze", "review"],
      approvals: {
        pr_creation: "required",
      },
    })

    expect(response.status).toBe(201)
    expect(expectData(body)).toEqual(
      expect.objectContaining({
        kind: "harness",
        name: "Governed review harness",
        phases: ["collect", "analyze", "review"],
        approvals: { pr_creation: "required" },
      }),
    )
  })

  it("creates a playbook and attaches a harness through the API", async () => {
    const harnessResult = await postJson<HarnessRecord>("/api/harnesses", {
      name: "Governed review harness",
      description: "Collect, analyze, and review with approval before review output",
      phases: ["collect", "analyze", "review"],
      approvals: {
        pr_creation: "required",
      },
    })
    const harness = expectData(harnessResult.body)

    const playbookResult = await postJson<PlaybookRecord>("/api/playbooks", {
      name: "Sprint retrospective",
      description: "Prepare a governed retrospective outcome for operators",
      goal: "Turn sprint feedback into a reviewed retrospective artifact",
      instructions: "Collect sprint notes, analyze themes, and prepare the final review package.",
      inputs: [
        {
          name: "sprint_name",
          type: "string",
          required: true,
          description: "Sprint to review",
        },
      ],
      artifacts: [{ type: "retro_document", format: "markdown" }],
    })

    expect(playbookResult.response.status).toBe(201)
    const playbook = expectData(playbookResult.body)

    const attachResult = await postJson<PlaybookRecord>(
      `/api/harnesses/${harness.id}/attach/${playbook.id}`,
      {},
    )

    expect(attachResult.response.status).toBe(200)
    expect(expectData(attachResult.body)).toEqual(
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

  it("lists and retrieves playbooks with harness summary, goal, inputs, and artifacts", async () => {
    const { harness, playbook } = await seedHarnessAndPlaybook()

    const listResult = await requestJson<PlaybookRecord[]>("/api/playbooks")
    expect(listResult.response.status).toBe(200)

    const playbooks = expectData(listResult.body)
    expect(playbooks).toHaveLength(1)
    expect(playbooks[0]).toEqual(
      expect.objectContaining({
        id: playbook.id,
        name: playbook.name,
        harness: expect.objectContaining({
          id: harness.id,
          name: harness.name,
          phases: ["collect", "analyze", "review"],
        }),
      }),
    )

    const detailResult = await requestJson<PlaybookRecord>(`/api/playbooks/${playbook.id}`)
    expect(detailResult.response.status).toBe(200)

    const detail = expectData(detailResult.body)
    expect(detail).toEqual(
      expect.objectContaining({
        id: playbook.id,
        goal: "Turn sprint feedback into a reviewed retrospective artifact",
        instructions: "Collect sprint notes, analyze themes, and prepare the final review package.",
        harness: expect.objectContaining({
          id: harness.id,
          name: harness.name,
        }),
      }),
    )
    expect(detail.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "sprint_name", type: "string", required: true }),
      ]),
    )
    expect(detail.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "retro_document", format: "markdown" }),
      ]),
    )
  })

  it("creates a queued run and lists it with playbook and harness names after direct transitions", async () => {
    const { harness, playbook } = await seedHarnessAndPlaybook()
    const runCreateResult = await postJson<RunRecord>("/api/runs", {
      playbookId: playbook.id,
      harnessId: harness.id,
      inputs: {
        sprint_name: "Sprint 42",
      },
    })

    expect(runCreateResult.response.status).toBe(201)

    const createdRun = expectData(runCreateResult.body)
    expect(createdRun).toEqual(
      expect.objectContaining({
        playbook: playbook.id,
        harness: harness.id,
        status: "queued",
        current_phase: "collect",
      }),
    )

    await ctx!.runService.transition(createdRun.id, "initializing")
    await ctx!.runService.transition(createdRun.id, "running")

    const runsResult = await requestJson<Array<RunRecord & { playbookName: string; harnessName: string }>>(
      "/api/runs",
    )

    expect(runsResult.response.status).toBe(200)
    expect(expectData(runsResult.body)).toEqual([
      expect.objectContaining({
        id: createdRun.id,
        status: "running",
        playbookName: playbook.name,
        harnessName: harness.name,
      }),
    ])
  })

  it("returns run detail with events and approvals, then resolves approval through the API", async () => {
    const { harness, playbook } = await seedHarnessAndPlaybook()
    const run = await ctx!.runService.create(playbook.id, harness.id, { sprint_name: "Sprint 43" })

    await ctx!.runService.transition(run.id, "initializing")
    await ctx!.runService.transition(run.id, "running")

    const approval = await ctx!.approvalService.createApproval({
      runId: run.id,
      actionClass: "pr_creation",
      title: "Review output approval",
      requestedBy: {
        source: "system",
        role_id: "operator",
      },
      context: {
        phase: "review",
        reason: "Review output requires operator approval",
      },
    })

    const detailBeforeResolve = await requestJson<RunDetailResponse>(`/api/runs/${run.id}`)
    expect(detailBeforeResolve.response.status).toBe(200)

    const beforeResolve = expectData(detailBeforeResolve.body)
    expect(beforeResolve.run).toEqual(expect.objectContaining({ id: run.id, status: "waiting_approval" }))
    expect(beforeResolve.approvals).toEqual([
      expect.objectContaining({
        id: approval.id,
        action_class: "pr_creation",
        status: "pending",
      }),
    ])
    expect(beforeResolve.artifacts).toEqual([])
    expect(beforeResolve.sessions).toEqual([])
    expect(beforeResolve.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["run.created", "run.status_changed", "approval.requested"]),
    )

    const resolveResult = await postJson<ApprovalRecord>(`/api/approvals/${approval.id}/resolve`, {
      decision: "approved",
      resolvedBy: "operator_1",
      note: "Approved for final review delivery",
    })

    expect(resolveResult.response.status).toBe(200)
    expect(expectData(resolveResult.body)).toEqual(
      expect.objectContaining({
        id: approval.id,
        status: "approved",
        resolution: expect.objectContaining({
          resolved_by: "operator_1",
          decision: "approved",
        }),
      }),
    )

    const detailAfterResolve = await requestJson<RunDetailResponse>(`/api/runs/${run.id}`)
    const afterResolve = expectData(detailAfterResolve.body)

    expect(afterResolve.run.status).toBe("running")
    expect(afterResolve.approvals[0]).toEqual(
      expect.objectContaining({
        id: approval.id,
        status: "approved",
      }),
    )
    expect(afterResolve.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["approval.requested", "approval.resolved"]),
    )
  })

  it("requires the expected artifact before a run can succeed and exposes it in run detail", async () => {
    const { harness, playbook } = await seedHarnessAndPlaybook()
    const run = await ctx!.runService.create(playbook.id, harness.id, { sprint_name: "Sprint 44" })

    await ctx!.runService.transition(run.id, "initializing")
    await ctx!.runService.transition(run.id, "running")

    await expect(ctx!.runService.transition(run.id, "succeeded")).rejects.toThrow(
      "required artifact missing: retro_document",
    )

    const artifact = await ctx!.artifactService.register({
      runId: run.id,
      type: "retro_document",
      title: "Sprint 44 retrospective",
      format: "markdown",
      producer: {
        role_id: "reviewer",
      },
    })

    expect(artifact).toEqual(
      expect.objectContaining({
        run_id: run.id,
        type: "retro_document",
        format: "markdown",
        status: "registered",
      }),
    )

    await ctx!.runService.transition(run.id, "succeeded")

    const detailResult = await requestJson<RunDetailResponse>(`/api/runs/${run.id}`)
    expect(detailResult.response.status).toBe(200)

    const detail = expectData(detailResult.body)
    expect(detail.run).toEqual(expect.objectContaining({ id: run.id, status: "succeeded" }))
    expect(detail.artifacts).toEqual([
      expect.objectContaining({
        id: artifact.id,
        type: "retro_document",
        title: "Sprint 44 retrospective",
      }),
    ])
    expect(detail.approvals).toEqual([])
    expect(detail.sessions).toEqual([])
    expect(detail.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["artifact.registered", "run.status_changed"]),
    )
  })
})
