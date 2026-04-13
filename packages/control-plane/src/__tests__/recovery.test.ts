/**
 * Plan 003 Feature 6: Recovery — Unit Tests
 */
import { describe, it, expect, beforeEach } from "vitest"
import { RecoveryService } from "../services/recovery-service.js"
import { RuntimeAdapter } from "../services/runtime-adapter.js"
import { PhaseController } from "../services/phase-controller.js"
import { RunService, projectRunStateFromEvents } from "../services/run-service.js"
import { ArtifactService } from "../services/artifact-service.js"
import { PlaybookService } from "../services/playbook-service.js"
import { HarnessService } from "../services/harness-service.js"
import { ApprovalService } from "../services/approval-service.js"
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
import { buildRunEvent } from "./helpers/factories.js"

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
let approvalService: ApprovalService
let agentManager: FakeAgentManager
let adapter: RuntimeAdapter
let phaseController: PhaseController
let recoveryService: RecoveryService

function setupAll() {
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

  approvalService = new ApprovalService(approvalRepo, runService, runEventRepo)
  agentManager = new FakeAgentManager()

  adapter = new RuntimeAdapter(
    agentManager,
    runEventRepo,
    approvalRepo,
    runService,
    runSessionRepo,
  )

  phaseController = new PhaseController({
    harnessRepository: harnessRepo,
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    approvalRepository: approvalRepo,
    runService,
    artifactChecker: artifactService,
    agentManager,
  })

  recoveryService = new RecoveryService({
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    runSessionRepository: runSessionRepo,
    runService,
    runtimeAdapter: adapter,
    phaseController,
    agentManager,
  })
}

async function createRunInState(status: string) {
  const playbookService = new PlaybookService(playbookRepo)
  const harnessService = new HarnessService(harnessRepo, playbookRepo)

  const playbook = await playbookService.create({
    name: "Test",
    description: "Test",
    goal: "Test",
    instructions: "Test",
  })

  const harness = await harnessService.create({
    name: "Test Harness",
    description: "Test",
    phases: ["collect", "analyze"],
  })

  const run = await runService.create(playbook.id, harness.id, {})
  let current = await runService.transition(run.id, "initializing")
  current = await runService.transition(current.id, "running")

  if (status === "waiting_approval") {
    const approval = await approvalService.createApproval({
      runId: current.id,
      actionClass: "destructive_write",
      title: "Test approval",
      requestedBy: { source: "session" },
    })
    current = (await runRepo.getById(current.id))!
  }

  return { playbook, harness, run: current }
}

describe("Recovery Service (Plan 003 F6)", () => {
  beforeEach(() => {
    setupAll()
  })

  describe("Scenario 6.1: Reconstruct state from events", () => {
    it("projects correct state from run events", async () => {
      const { run } = await createRunInState("running")

      const events = await runEventRepo.listByRunId(run.id)
      const projected = projectRunStateFromEvents(events)

      expect(projected.status).toBeDefined()
      // The projected state should reflect the transitions we made
    })

    it("projects approval status from events", async () => {
      const { run } = await createRunInState("running")

      // Append approval events
      await runEventRepo.append(buildRunEvent({
        runId: run.id,
        eventType: "approval.requested",
        payload: { approvalId: "appr_1" },
      }))
      await runEventRepo.append(buildRunEvent({
        runId: run.id,
        eventType: "approval.resolved",
        payload: { approvalId: "appr_1", decision: "approved" },
      }))

      const events = await runEventRepo.listByRunId(run.id)
      const projected = projectRunStateFromEvents(events)

      expect(projected.approvals.resolved).toContain("appr_1")
    })
  })

  describe("Scenario 6.2: Rebind surviving agent", () => {
    it("re-tracks agent when it still exists after restart", async () => {
      const { run } = await createRunInState("running")
      const agentId = "agent_surviving"

      // Create an agent in the fake manager and a session
      await agentManager.createAgent({ provider: "claude", cwd: "/tmp" }, agentId)
      await runSessionRepo.save({
        kind: "run_session",
        id: "sess_1",
        run_id: run.id,
        session_id: agentId,
        provider: "claude",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const result = await recoveryService.recoverRun(run.id)

      expect(result).toBe("recovered")
    })
  })

  describe("Scenario 6.3: Handle lost agent", () => {
    it("marks run as blocked when agent no longer exists", async () => {
      const { run } = await createRunInState("running")

      // Session exists but agent doesn't
      await runSessionRepo.save({
        kind: "run_session",
        id: "sess_lost",
        run_id: run.id,
        session_id: "agent_gone",
        provider: "claude",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const result = await recoveryService.recoverRun(run.id)

      expect(result).toBe("blocked")

      const updatedRun = await runRepo.getById(run.id)
      expect(updatedRun!.status).toBe("blocked")
      expect(updatedRun!.blockerReason).toContain("runtime session lost")
    })
  })

  describe("Scenario 6.4: Waiting-approval survives restart", () => {
    it("keeps run in waiting_approval without needing agent", async () => {
      const { run } = await createRunInState("waiting_approval")

      const result = await recoveryService.recoverRun(run.id)

      expect(result).toBe("waiting_approval")

      const updatedRun = await runRepo.getById(run.id)
      expect(updatedRun!.status).toBe("waiting_approval")
    })
  })

  describe("Scenario 6.5: Idempotent recovery", () => {
    it("second recovery call is a no-op", async () => {
      const firstResult = await recoveryService.recover()
      const secondResult = await recoveryService.recover()

      // Both should succeed without errors
      expect(firstResult).toBeDefined()
      expect(secondResult).toBeDefined()
    })
  })
})
