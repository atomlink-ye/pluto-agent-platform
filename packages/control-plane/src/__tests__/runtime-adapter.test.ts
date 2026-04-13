/**
 * Plan 003 Feature 2: Runtime Adapter — Unit Tests
 */
import { describe, it, expect, beforeEach } from "vitest"
import { RuntimeAdapter } from "../services/runtime-adapter.js"
import { RunService } from "../services/run-service.js"
import { ArtifactService } from "../services/artifact-service.js"
import { PlaybookService } from "../services/playbook-service.js"
import { HarnessService } from "../services/harness-service.js"
import { FakeAgentManager } from "../paseo/fake-agent-manager.js"
import {
  InMemoryPlaybookRepository,
  InMemoryHarnessRepository,
  InMemoryRunRepository,
  InMemoryRunEventRepository,
  InMemoryRunPlanRepository,
  InMemoryPolicySnapshotRepository,
  InMemoryApprovalRepository,
  InMemoryArtifactRepository,
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

async function setupWithRun() {
  const playbookService = new PlaybookService(playbookRepo)
  const harnessService = new HarnessService(harnessRepo, playbookRepo)

  const playbook = await playbookService.create({
    name: "Test Playbook",
    description: "Test",
    goal: "Test goal",
    instructions: "Test instructions",
  })

  const harness = await harnessService.create({
    name: "Test Harness",
    description: "Test",
    phases: ["collect", "analyze", "review"],
  })

  const run = await runService.create(playbook.id, harness.id, { topic: "test" })
  const runAfterInit = await runService.transition(run.id, "initializing")
  const runAfterStart = await runService.transition(runAfterInit.id, "running")

  return { playbook, harness, run: runAfterStart }
}

describe("Runtime Adapter (Plan 003 F2)", () => {
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
      runRepo,
      runSessionRepo,
      approvalRepo,
      runService,
    )
  })

  describe("Scenario 2.1: Map thread_started to session.created", () => {
    it("appends session.created event and creates RunSession", async () => {
      const { run } = await setupWithRun()
      const agentId = "agent-1"

      adapter.trackRun(run.id, agentId)
      adapter.start()

      agentManager.emit(agentId, {
        type: "thread_started",
        sessionId: "sess_abc",
        provider: "claude",
      }, 1, "epoch_1")

      // Wait for async processing
      await new Promise((r) => setTimeout(r, 50))

      const events = await runEventRepo.listByRunId(run.id)
      const sessionEvents = events.filter((e) => e.eventType === "session.created")
      expect(sessionEvents).toHaveLength(1)
      expect((sessionEvents[0].payload as Record<string, unknown>).sessionId).toBe("sess_abc")

      const sessions = await runSessionRepo.listByRunId(run.id)
      expect(sessions).toHaveLength(1)
      expect(sessions[0].session_id).toBe(agentId)
      expect(sessions[0].provider).toBe("claude")
    })
  })

  describe("Scenario 2.2: Map permission_requested to approval.requested", () => {
    it("creates ApprovalTask and appends approval.requested event", async () => {
      const { run } = await setupWithRun()
      const agentId = "agent-1"

      adapter.trackRun(run.id, agentId)
      adapter.start()

      agentManager.emit(agentId, {
        type: "permission_requested",
        provider: "claude",
        request: {
          id: "perm_1",
          kind: "tool",
          name: "bash",
          description: "delete production branch",
        },
      }, 2, "epoch_1")

      await new Promise((r) => setTimeout(r, 50))

      const events = await runEventRepo.listByRunId(run.id)
      const approvalEvents = events.filter((e) => e.eventType === "approval.requested")
      expect(approvalEvents).toHaveLength(1)

      const approvals = await approvalRepo.listByRunId(run.id)
      expect(approvals).toHaveLength(1)
      expect(approvals[0].status).toBe("pending")
      expect(approvals[0].title).toContain("bash")
      expect(approvals[0].title).toContain("delete production branch")

      // Run should be in waiting_approval
      const updatedRun = await runRepo.getById(run.id)
      expect(updatedRun!.status).toBe("waiting_approval")
    })
  })

  describe("Scenario 2.3: Idempotent on duplicate events", () => {
    it("does not create duplicate events for same seq+epoch", async () => {
      const { run } = await setupWithRun()
      const agentId = "agent-1"

      adapter.trackRun(run.id, agentId)
      adapter.start()

      const event = {
        type: "thread_started" as const,
        sessionId: "sess_abc",
        provider: "claude",
      }

      agentManager.emit(agentId, event, 5, "abc")
      await new Promise((r) => setTimeout(r, 50))

      agentManager.emit(agentId, event, 5, "abc")
      await new Promise((r) => setTimeout(r, 50))

      const events = await runEventRepo.listByRunId(run.id)
      const sessionEvents = events.filter((e) => e.eventType === "session.created")
      expect(sessionEvents).toHaveLength(1)
    })
  })

  describe("Scenario 2.4: Ignore untracked agents", () => {
    it("does not create events for agents not spawned by control plane", async () => {
      const { run } = await setupWithRun()
      const trackedAgentId = "agent-tracked"
      const untrackedAgentId = "agent-standalone"

      adapter.trackRun(run.id, trackedAgentId)
      adapter.start()

      // Emit for untracked agent
      agentManager.emit(untrackedAgentId, {
        type: "thread_started",
        sessionId: "sess_untracked",
        provider: "claude",
      }, 1, "epoch_untracked")

      await new Promise((r) => setTimeout(r, 50))

      // No events should be created for the run
      const events = await runEventRepo.listByRunId(run.id)
      const sessionEvents = events.filter((e) => e.eventType === "session.created")
      expect(sessionEvents).toHaveLength(0)
    })
  })

  describe("Scenario 2.5: Custom MCP phase declaration", () => {
    it("appends phase.entered event and updates run current phase", async () => {
      const { run } = await setupWithRun()
      const agentId = "agent-1"

      adapter.trackRun(run.id, agentId)

      // Simulate the lead agent calling declare_phase MCP tool
      await adapter.handleDeclarePhase(run.id, "analyze")

      const events = await runEventRepo.listByRunId(run.id)
      const phaseEvents = events.filter((e) => e.eventType === "phase.entered")
      expect(phaseEvents).toHaveLength(1)
      expect((phaseEvents[0].payload as Record<string, unknown>).phase).toBe("analyze")

      // Run's current phase should be updated
      const updatedRun = await runRepo.getById(run.id)
      expect(updatedRun!.current_phase).toBe("analyze")
    })
  })

  describe("Additional: attention_required events", () => {
    it("maps attention_required(finished) to run.completed", async () => {
      const { run } = await setupWithRun()
      const agentId = "agent-1"

      adapter.trackRun(run.id, agentId)
      adapter.start()

      agentManager.emit(agentId, {
        type: "attention_required",
        provider: "claude",
        reason: "finished",
        timestamp: new Date().toISOString(),
      }, 10, "epoch_1")

      await new Promise((r) => setTimeout(r, 50))

      const events = await runEventRepo.listByRunId(run.id)
      const completedEvents = events.filter((e) => e.eventType === "run.completed")
      expect(completedEvents).toHaveLength(1)
    })

    it("maps attention_required(error) to run.failed", async () => {
      const { run } = await setupWithRun()
      const agentId = "agent-1"

      adapter.trackRun(run.id, agentId)
      adapter.start()

      agentManager.emit(agentId, {
        type: "attention_required",
        provider: "claude",
        reason: "error",
        timestamp: new Date().toISOString(),
      }, 11, "epoch_1")

      await new Promise((r) => setTimeout(r, 50))

      const events = await runEventRepo.listByRunId(run.id)
      const failedEvents = events.filter((e) => e.eventType === "run.failed")
      expect(failedEvents).toHaveLength(1)
    })
  })
})
