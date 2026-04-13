/**
 * Plan 003 Feature 4: Phase Controller — Unit Tests
 */
import { describe, it, expect, beforeEach } from "vitest"
import { PhaseController } from "../services/phase-controller.js"
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
} from "../repositories/in-memory.js"

let playbookRepo: InMemoryPlaybookRepository
let harnessRepo: InMemoryHarnessRepository
let runRepo: InMemoryRunRepository
let runEventRepo: InMemoryRunEventRepository
let runPlanRepo: InMemoryRunPlanRepository
let policySnapshotRepo: InMemoryPolicySnapshotRepository
let approvalRepo: InMemoryApprovalRepository
let artifactRepo: InMemoryArtifactRepository
let runService: RunService
let artifactService: ArtifactService
let agentManager: FakeAgentManager
let controller: PhaseController

function setupAll() {
  playbookRepo = new InMemoryPlaybookRepository()
  harnessRepo = new InMemoryHarnessRepository()
  runRepo = new InMemoryRunRepository()
  runEventRepo = new InMemoryRunEventRepository()
  runPlanRepo = new InMemoryRunPlanRepository()
  policySnapshotRepo = new InMemoryPolicySnapshotRepository()
  approvalRepo = new InMemoryApprovalRepository()
  artifactRepo = new InMemoryArtifactRepository()

  artifactService = new ArtifactService(
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

  controller = new PhaseController({
    harnessRepository: harnessRepo,
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    approvalRepository: approvalRepo,
    runService,
    artifactChecker: artifactService,
    agentManager,
  })
}

async function createRunInPhase(currentPhase: string, harnessOverrides = {}) {
  const playbookService = new PlaybookService(playbookRepo)
  const harnessService = new HarnessService(harnessRepo, playbookRepo)

  const playbook = await playbookService.create({
    name: "Test",
    description: "Test",
    goal: "Test goal",
    instructions: "Test instructions",
  })

  const harness = await harnessService.create({
    name: "Test Harness",
    description: "Test",
    phases: ["collect", "analyze", "review"],
    ...harnessOverrides,
  })

  const run = await runService.create(playbook.id, harness.id, { topic: "test" })
  let current = await runService.transition(run.id, "initializing")
  current = await runService.transition(current.id, "running")

  // Set the current phase
  current.current_phase = currentPhase
  current.updatedAt = new Date().toISOString()
  await runRepo.update(current)

  return { playbook, harness, run: current }
}

describe("Phase Controller (Plan 003 F4)", () => {
  beforeEach(() => {
    setupAll()
  })

  describe("Scenario 4.1: Enforce phase ordering", () => {
    it("rejects out-of-order phase transition (skipping a phase)", async () => {
      const { run } = await createRunInPhase("collect")

      const result = await controller.handlePhaseDeclaration(run.id, "review")

      expect(result.allowed).toBe(false)
      expect(result.error).toContain("cannot enter 'review'")
      expect(result.error).toContain("'analyze'")
    })

    it("allows sequential phase transition", async () => {
      const { run } = await createRunInPhase("collect")

      const result = await controller.handlePhaseDeclaration(run.id, "analyze")

      expect(result.allowed).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it("rejects backward phase transition", async () => {
      const { run } = await createRunInPhase("analyze")

      const result = await controller.handlePhaseDeclaration(run.id, "collect")

      expect(result.allowed).toBe(false)
      expect(result.error).toContain("cannot enter 'collect'")
    })

    it("records phase.rejected event for invalid transitions", async () => {
      const { run } = await createRunInPhase("collect")

      await controller.handlePhaseDeclaration(run.id, "review")

      const events = await runEventRepo.listByRunId(run.id)
      const rejectedEvents = events.filter((e) => e.eventType === "phase.rejected")
      expect(rejectedEvents).toHaveLength(1)
    })
  })

  describe("Scenario 4.2: Approval gate pauses run", () => {
    it("creates ApprovalTask and transitions to waiting_approval on gated phase", async () => {
      const { run } = await createRunInPhase("analyze", {
        approvals: { destructive_write: "required" },
      })

      controller.registerRunAgent(run.id, "agent-1")

      await controller.handlePhaseDeclaration(run.id, "review")

      // Approval should be created
      const approvals = await approvalRepo.listByRunId(run.id)
      expect(approvals).toHaveLength(1)
      expect(approvals[0].status).toBe("pending")
      expect(approvals[0].context?.phase).toBe("review")

      // Run should be in waiting_approval
      const updatedRun = await runRepo.getById(run.id)
      expect(updatedRun!.status).toBe("waiting_approval")
    })
  })

  describe("Scenario 4.3: Approval resolution resumes agent", () => {
    it("sends continuation prompt to agent when approved", async () => {
      const { run } = await createRunInPhase("analyze", {
        approvals: { destructive_write: "required" },
      })

      const agentId = "agent-1"
      controller.registerRunAgent(run.id, agentId)
      await agentManager.createAgent({ provider: "claude", cwd: "/tmp" }, agentId)

      // Enter gated phase
      await controller.handlePhaseDeclaration(run.id, "review")

      // Resolve the approval
      await controller.handleApprovalResolution(run.id, "appr_1", "approved")

      // Agent should have received a continuation prompt
      expect(agentManager.runAgentCalls.length).toBeGreaterThan(0)
      const lastCall = agentManager.runAgentCalls[agentManager.runAgentCalls.length - 1]
      expect(lastCall.agentId).toBe(agentId)
      expect(lastCall.prompt).toContain("Approval granted")
    })
  })

  describe("Scenario 4.4: Missing artifact blocks completion", () => {
    it("rejects completion when required artifacts are missing", async () => {
      const playbookService = new PlaybookService(playbookRepo)
      const harnessService = new HarnessService(harnessRepo, playbookRepo)

      const playbook = await playbookService.create({
        name: "Retro",
        description: "Sprint retro",
        goal: "Collect feedback",
        instructions: "Guide team",
        artifacts: [{ type: "retro_document" }],
      })

      const harness = await harnessService.create({
        name: "3-Phase",
        description: "Test",
        phases: ["collect", "analyze", "review"],
      })

      const run = await runService.create(playbook.id, harness.id, {})
      await runService.transition(run.id, "initializing")
      await runService.transition(run.id, "running")

      const result = await controller.handleCompletionCheck(run.id)

      expect(result.allowed).toBe(false)
      expect(result.error).toContain("retro_document")
    })

    it("allows completion when all required artifacts are present", async () => {
      const playbookService = new PlaybookService(playbookRepo)
      const harnessService = new HarnessService(harnessRepo, playbookRepo)

      const playbook = await playbookService.create({
        name: "Retro",
        description: "Sprint retro",
        goal: "Collect feedback",
        instructions: "Guide team",
        artifacts: [{ type: "retro_document" }],
      })

      const harness = await harnessService.create({
        name: "3-Phase",
        description: "Test",
        phases: ["collect"],
      })

      const run = await runService.create(playbook.id, harness.id, {})
      await runService.transition(run.id, "initializing")
      await runService.transition(run.id, "running")

      // Register required artifact
      await artifactService.register({
        runId: run.id,
        type: "retro_document",
        title: "Sprint Retro Doc",
        format: "markdown",
      })

      const result = await controller.handleCompletionCheck(run.id)
      expect(result.allowed).toBe(true)
    })
  })

  describe("Scenario 4.5: Phase timeout", () => {
    it("transitions run to blocked when phase exceeds timeout", async () => {
      const { run } = await createRunInPhase("collect", {
        timeouts: { per_phase: { analyze: 0.001 } }, // ~60ms
      })

      await controller.handlePhaseDeclaration(run.id, "analyze")

      // Wait for the timeout to fire
      await new Promise((r) => setTimeout(r, 150))

      const updatedRun = await runRepo.getById(run.id)
      expect(updatedRun!.status).toBe("blocked")
      expect(updatedRun!.blockerReason).toContain("exceeded timeout")

      controller.cleanup(run.id)
    })
  })

  describe("All controller decisions are recorded as RunEvents", () => {
    it("records phase.entered event on successful transition", async () => {
      const { run } = await createRunInPhase("collect")

      await controller.handlePhaseDeclaration(run.id, "analyze")

      const events = await runEventRepo.listByRunId(run.id)
      const phaseEvents = events.filter((e) => e.eventType === "phase.entered")
      expect(phaseEvents).toHaveLength(1)
      expect((phaseEvents[0].payload as Record<string, unknown>).phase).toBe("analyze")
    })
  })
})
