/**
 * Plan 003 Feature 5: RunSession Binding — Unit Tests
 */
import { describe, it, expect, beforeEach } from "vitest"
import { RunCompiler, type CompileRunInput } from "../services/run-compiler.js"
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
let compiler: RunCompiler
let adapter: RuntimeAdapter

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

  agentManager = new FakeAgentManager()

  adapter = new RuntimeAdapter(
    agentManager,
    runEventRepo,
    approvalRepo,
    runService,
    runSessionRepo,
  )

  compiler = new RunCompiler({
    playbookRepository: playbookRepo,
    harnessRepository: harnessRepo,
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    runPlanRepository: runPlanRepo,
    policySnapshotRepository: policySnapshotRepo,
    runSessionRepository: runSessionRepo,
    runService,
    agentManager,
    runtimeAdapter: adapter,
  })
}

async function createPlaybookAndHarness() {
  const playbookService = new PlaybookService(playbookRepo)
  const harnessService = new HarnessService(harnessRepo, playbookRepo)

  const playbook = await playbookService.create({
    name: "Sprint Retro",
    description: "A sprint retrospective",
    goal: "Collect feedback",
    instructions: "Guide the team",
  })

  const harness = await harnessService.create({
    name: "3-Phase",
    description: "Three phases",
    phases: ["collect", "analyze", "review"],
  })

  return { playbook, harness }
}

describe("RunSession Binding (Plan 003 F5)", () => {
  beforeEach(() => {
    setupAll()
  })

  describe("Scenario 5.1: Session created on agent spawn", () => {
    it("creates RunSession with status active when run is compiled", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()

      const run = await compiler.compile({
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { topic: "test" },
      })

      const sessions = await runSessionRepo.listByRunId(run.id)
      expect(sessions).toHaveLength(1)
      expect(sessions[0].status).toBe("active")
      expect(sessions[0].provider).toBe("claude")

      // Should be linked to the Paseo agent
      const agents = agentManager.listAgents()
      expect(sessions[0].session_id).toBe(agents[0].id)
    })
  })

  describe("Scenario 5.2: Session status tracks agent lifecycle", () => {
    it("RunSession can be updated to completed", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()

      const run = await compiler.compile({
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { topic: "test" },
      })

      const sessions = await runSessionRepo.listByRunId(run.id)
      const session = sessions[0]

      // Simulate agent finishing
      session.status = "completed"
      session.updatedAt = new Date().toISOString()
      await runSessionRepo.update(session)

      const updated = await runSessionRepo.getById(session.id)
      expect(updated!.status).toBe("completed")
    })
  })

  describe("Scenario 5.4: Multiple sessions for one run", () => {
    it("supports multiple RunSessions per run for retry scenarios", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()

      const run = await compiler.compile({
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { topic: "test" },
      })

      const sessions = await runSessionRepo.listByRunId(run.id)
      const firstSession = sessions[0]
      firstSession.status = "failed"
      await runSessionRepo.update(firstSession)

      // Simulate creating a second session (retry)
      await runSessionRepo.save({
        kind: "run_session",
        id: "sess_retry",
        run_id: run.id,
        session_id: "agent_retry",
        provider: "claude",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const allSessions = await runSessionRepo.listByRunId(run.id)
      expect(allSessions).toHaveLength(2)
      expect(allSessions.some((s) => s.status === "failed")).toBe(true)
      expect(allSessions.some((s) => s.status === "active")).toBe(true)
    })
  })
})
