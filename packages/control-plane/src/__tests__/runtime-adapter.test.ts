import { beforeEach, describe, expect, it } from "vitest"

import { HarnessService } from "../services/harness-service.js"
import { RuntimeAdapter } from "../services/runtime-adapter.js"
import { PlaybookService } from "../services/playbook-service.js"
import { RunService } from "../services/run-service.js"
import { ArtifactService } from "../services/artifact-service.js"
import { FakeAgentManager } from "../paseo/fake-agent-manager.js"
import {
  InMemoryApprovalRepository,
  InMemoryArtifactRepository,
  InMemoryHarnessRepository,
  InMemoryPlaybookRepository,
  InMemoryPolicySnapshotRepository,
  InMemoryRunEventRepository,
  InMemoryRunPlanRepository,
  InMemoryRunRepository,
  InMemoryRunSessionRepository,
} from "../repositories/in-memory.js"

let playbookRepo: InMemoryPlaybookRepository
let harnessRepo: InMemoryHarnessRepository
let runRepo: InMemoryRunRepository
let runEventRepo: InMemoryRunEventRepository
let runPlanRepo: InMemoryRunPlanRepository
let policySnapshotRepo: InMemoryPolicySnapshotRepository
let approvalRepo: InMemoryApprovalRepository
let artifactRepo: InMemoryArtifactRepository
let runSessionRepo: InMemoryRunSessionRepository
let runService: RunService
let agentManager: FakeAgentManager
let adapter: RuntimeAdapter

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function createRunningRun() {
  const playbookService = new PlaybookService(playbookRepo)
  const harnessService = new HarnessService(harnessRepo, playbookRepo)

  const playbook = await playbookService.create({
    name: "runtime-adapter-playbook",
    description: "Runtime adapter test playbook",
    goal: "Exercise runtime event projection",
    instructions: "Process runtime events",
  })

  const harness = await harnessService.create({
    name: "runtime-adapter-harness",
    description: "Runtime adapter test harness",
    phases: ["collect", "analyze", "review"],
  })

  const run = await runService.create(playbook.id, harness.id, { topic: "runtime adapter" })

  await runService.transition(run.id, "initializing")

  return runService.transition(run.id, "running")
}

describe("RuntimeAdapter", () => {
  beforeEach(() => {
    playbookRepo = new InMemoryPlaybookRepository()
    harnessRepo = new InMemoryHarnessRepository()
    runRepo = new InMemoryRunRepository()
    runEventRepo = new InMemoryRunEventRepository()
    runPlanRepo = new InMemoryRunPlanRepository()
    policySnapshotRepo = new InMemoryPolicySnapshotRepository()
    approvalRepo = new InMemoryApprovalRepository()
    artifactRepo = new InMemoryArtifactRepository()
    runSessionRepo = new InMemoryRunSessionRepository()

    const artifactService = new ArtifactService(
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

    agentManager = new FakeAgentManager()
    adapter = new RuntimeAdapter(
      agentManager,
      runEventRepo,
      approvalRepo,
      runService,
      runSessionRepo,
    )
  })

  it("scenario 2.1: thread_started -> session.created", async () => {
    const run = await createRunningRun()

    adapter.trackRun(run.id, "agent-1")
    const stop = adapter.start()

    agentManager.emit(
      "agent-1",
      {
        type: "thread_started",
        sessionId: "sess_runtime_1",
        provider: "claude",
      },
      1,
      "epoch-1",
    )

    await flush()
    stop()

    const events = await runEventRepo.listByRunId(run.id)
    const sessions = await runSessionRepo.listByRunId(run.id)

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "session.created",
          sessionId: "sess_runtime_1",
          payload: expect.objectContaining({
            runtimeSessionId: "sess_runtime_1",
            agentId: "agent-1",
          }),
        }),
      ]),
    )
    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          run_id: run.id,
          session_id: "agent-1",
          persistence_handle: "sess_runtime_1",
          provider: "claude",
          status: "active",
        }),
      ]),
    )
  })

  it("updates RunSession persistence_handle from agent_state events", async () => {
    const run = await createRunningRun()
    const createdAgent = await agentManager.createAgent({ provider: "claude", cwd: "/tmp" }, "agent-1")

    await runSessionRepo.save({
      kind: "run_session",
      id: "sess_1",
      run_id: run.id,
      session_id: "agent-1",
      provider: "claude",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    adapter.trackRun(run.id, "agent-1")
    const stop = adapter.start()

    createdAgent.persistence = {
      provider: "claude",
      sessionId: "provider-session-from-state",
    }
    createdAgent.updatedAt = new Date()
    agentManager.emitAgentState(createdAgent)

    await flush()
    stop()

    const sessions = await runSessionRepo.listByRunId(run.id)

    expect(sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          session_id: "agent-1",
          persistence_handle: "provider-session-from-state",
        }),
      ]),
    )
  })

  it("scenario 2.2: permission_requested -> approval.requested + ApprovalTask", async () => {
    const run = await createRunningRun()

    adapter.trackRun(run.id, "agent-1")
    const stop = adapter.start()

    agentManager.emit(
      "agent-1",
      {
        type: "permission_requested",
        provider: "claude",
        request: {
          id: "perm-1",
          kind: "tool",
          name: "bash",
          description: "delete production branch",
        },
      },
      2,
      "epoch-1",
    )

    await flush()
    stop()

    const approvals = await approvalRepo.listByRunId(run.id)
    const events = await runEventRepo.listByRunId(run.id)
    const updatedRun = await runRepo.getById(run.id)

    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toEqual(
      expect.objectContaining({
        run_id: run.id,
        status: "pending",
        title: expect.stringContaining("bash"),
      }),
    )
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "approval.requested",
          payload: expect.objectContaining({
            approvalId: approvals[0].id,
            permissionRequestId: "perm-1",
            name: "bash",
          }),
        }),
      ]),
    )
    expect(updatedRun?.status).toBe("waiting_approval")
  })

  it("scenario 2.3: duplicate seq+epoch events are no-ops", async () => {
    const run = await createRunningRun()

    adapter.trackRun(run.id, "agent-1")
    const stop = adapter.start()

    const event = {
      type: "thread_started" as const,
      sessionId: "sess_runtime_1",
      provider: "claude",
    }

    agentManager.emit("agent-1", event, 5, "epoch-dup")
    agentManager.emit("agent-1", event, 5, "epoch-dup")

    await flush()
    stop()

    const events = await runEventRepo.listByRunId(run.id)

    expect(events.filter((candidate) => candidate.eventType === "session.created")).toHaveLength(1)
  })

  it("deduplicates persisted seq+epoch events across adapter instances", async () => {
    const run = await createRunningRun()

    adapter.trackRun(run.id, "agent-1")
    let stop = adapter.start()

    agentManager.emit(
      "agent-1",
      {
        type: "thread_started",
        sessionId: "sess_runtime_1",
        provider: "claude",
      },
      8,
      "epoch-persisted",
    )

    await flush()
    stop()

    adapter = new RuntimeAdapter(
      agentManager,
      runEventRepo,
      approvalRepo,
      runService,
      runSessionRepo,
    )

    adapter.trackRun(run.id, "agent-1")
    stop = adapter.start()

    agentManager.emit(
      "agent-1",
      {
        type: "thread_started",
        sessionId: "sess_runtime_1",
        provider: "claude",
      },
      8,
      "epoch-persisted",
    )

    await flush()
    stop()

    const events = await runEventRepo.listByRunId(run.id)

    expect(events.filter((candidate) => candidate.eventType === "session.created")).toHaveLength(1)
  })

  it("scenario 2.4: events for untracked agents are ignored", async () => {
    const run = await createRunningRun()

    adapter.trackRun(run.id, "agent-tracked")
    const stop = adapter.start()

    agentManager.emit(
      "agent-standalone",
      {
        type: "thread_started",
        sessionId: "sess_untracked",
        provider: "claude",
      },
      1,
      "epoch-untracked",
    )

    await flush()
    stop()

    const events = await runEventRepo.listByRunId(run.id)
    const sessions = await runSessionRepo.listByRunId(run.id)

    expect(events.some((event) => event.eventType === "session.created")).toBe(false)
    expect(sessions).toHaveLength(0)
  })

  it("scenario 2.5: custom MCP declare_phase -> phase.entered", async () => {
    const run = await createRunningRun()

    adapter.trackRun(run.id, "agent-1")
    const stop = adapter.start()

    agentManager.emit(
      "agent-1",
      {
        type: "timeline",
        provider: "claude",
        item: {
          type: "tool_call",
          name: "declare_phase",
          input: {
            phase: "analyze",
          },
        },
      },
      3,
      "epoch-1",
    )

    await flush()
    stop()

    const events = await runEventRepo.listByRunId(run.id)
    const updatedRun = await runRepo.getById(run.id)

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "phase.entered",
          phase: "analyze",
          payload: expect.objectContaining({
            phase: "analyze",
          }),
        }),
      ]),
    )
    expect(updatedRun?.current_phase).toBe("analyze")
  })

  it("moves the run to waiting_approval on attention_required(permission)", async () => {
    const run = await createRunningRun()

    adapter.trackRun(run.id, "agent-1")
    const stop = adapter.start()

    agentManager.emit(
      "agent-1",
      {
        type: "attention_required",
        provider: "claude",
        reason: "permission",
        timestamp: new Date().toISOString(),
      },
      4,
      "epoch-1",
    )

    await flush()
    stop()

    const updatedRun = await runRepo.getById(run.id)

    expect(updatedRun?.status).toBe("waiting_approval")
  })
})
