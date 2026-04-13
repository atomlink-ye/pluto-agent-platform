/**
 * E2E Run Lifecycle Test
 *
 * Validates the minimum reference scenario end-to-end:
 * Operator creates run → agent executes → phases progress →
 * approval pauses/resumes → artifact registered → run succeeds.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { RunCompiler, type CompileRunInput } from "../services/run-compiler.js"
import { RuntimeAdapter } from "../services/runtime-adapter.js"
import { PhaseController } from "../services/phase-controller.js"
import { RecoveryService } from "../services/recovery-service.js"
import { RunService } from "../services/run-service.js"
import { ApprovalService } from "../services/approval-service.js"
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

let playbookService: PlaybookService
let harnessService: HarnessService
let runService: RunService
let approvalService: ApprovalService
let artifactService: ArtifactService
let agentManager: FakeAgentManager
let compiler: RunCompiler
let adapter: RuntimeAdapter
let phaseController: PhaseController
let playbookRepo: InMemoryPlaybookRepository
let harnessRepo: InMemoryHarnessRepository
let runRepo: InMemoryRunRepository
let runEventRepo: InMemoryRunEventRepository
let approvalRepo: InMemoryApprovalRepository
let artifactRepo: InMemoryArtifactRepository
let runSessionRepo: InMemoryRunSessionRepository

function wireSystem() {
  playbookRepo = new InMemoryPlaybookRepository()
  harnessRepo = new InMemoryHarnessRepository()
  runRepo = new InMemoryRunRepository()
  runEventRepo = new InMemoryRunEventRepository()
  const runPlanRepo = new InMemoryRunPlanRepository()
  const policySnapshotRepo = new InMemoryPolicySnapshotRepository()
  approvalRepo = new InMemoryApprovalRepository()
  artifactRepo = new InMemoryArtifactRepository()
  runSessionRepo = new InMemoryRunSessionRepository()

  playbookService = new PlaybookService(playbookRepo)
  harnessService = new HarnessService(harnessRepo, playbookRepo)

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

describe("E2E: Full Run Lifecycle (Minimum Reference Scenario)", () => {
  beforeEach(() => {
    wireSystem()
  })

  it("executes complete governed run from creation to success", async () => {
    // === 1. Create playbook with required artifact ===
    const playbook = await playbookService.create({
      name: "Sprint Retrospective",
      description: "Facilitate a sprint retrospective session",
      goal: "Collect team feedback and produce actionable improvements",
      instructions: "Guide through what went well, what didn't, and action items",
      artifacts: [{ type: "retro_document", format: "markdown" }],
    })

    // === 2. Create harness with phases and approval rule ===
    const harness = await harnessService.create({
      name: "Standard 3-Phase",
      description: "Three-phase governed execution",
      phases: ["collect", "analyze", "review"],
      approvals: { destructive_write: "required" },
    })

    // === 3. Compile a run (operator starts it) ===
    const run = await compiler.compile({
      playbookId: playbook.id,
      harnessId: harness.id,
      inputs: { topic: "Q1 Sprint 3", participants: 8 },
      provider: "claude",
    })

    expect(run.status).toBe("running")
    expect(run.current_phase).toBe("collect")

    // Verify agent was created
    const agents = agentManager.listAgents()
    expect(agents).toHaveLength(1)
    const agentId = agents[0].id

    // Register agent with phase controller
    phaseController.registerRunAgent(run.id, agentId)

    // Start the runtime adapter
    const unsubscribe = adapter.start()

    // === 4. Agent progresses through phases ===

    // Phase 1: collect (already current)
    // Simulate agent doing work in collect phase
    agentManager.emit(agentId, {
      type: "turn_started",
      provider: "claude",
    }, 1, "epoch_1")

    agentManager.emit(agentId, {
      type: "turn_completed",
      provider: "claude",
    }, 2, "epoch_1")

    await new Promise((r) => setTimeout(r, 50))

    // Agent declares transition to analyze
    const analyzeResult = await phaseController.handlePhaseDeclaration(run.id, "analyze")
    expect(analyzeResult.allowed).toBe(true)

    // Verify current phase updated
    let currentRun = await runRepo.getById(run.id)
    expect(currentRun!.current_phase).toBe("analyze")

    // Agent does work in analyze phase
    agentManager.emit(agentId, {
      type: "turn_started",
      provider: "claude",
    }, 3, "epoch_1")

    agentManager.emit(agentId, {
      type: "turn_completed",
      provider: "claude",
    }, 4, "epoch_1")

    await new Promise((r) => setTimeout(r, 50))

    // === 5. Agent declares review phase → triggers approval gate ===
    const reviewResult = await phaseController.handlePhaseDeclaration(run.id, "review")
    expect(reviewResult.allowed).toBe(true)

    // Review phase has approval gate — run should be in waiting_approval
    currentRun = await runRepo.getById(run.id)
    expect(currentRun!.status).toBe("waiting_approval")

    // Verify ApprovalTask was created
    const approvals = await approvalRepo.listByRunId(run.id)
    expect(approvals.length).toBeGreaterThanOrEqual(1)
    const pendingApproval = approvals.find((a) => a.status === "pending")
    expect(pendingApproval).toBeDefined()

    // === 6. Operator resolves approval → agent resumes ===
    await phaseController.handleApprovalResolution(run.id, pendingApproval!.id, "approved")

    // Resolve the approval in the approval service too
    await approvalService.resolve(pendingApproval!.id, "approved", "operator-1", "Looks good")

    currentRun = await runRepo.getById(run.id)
    expect(currentRun!.status).toBe("running")

    // Verify agent received continuation prompt
    const runCalls = agentManager.runAgentCalls
    expect(runCalls.some((c) => {
      const prompt = typeof c.prompt === "string" ? c.prompt : ""
      return prompt.includes("Approval granted") || prompt.includes("approval")
    })).toBe(true)

    // === 7. Agent registers required artifact ===
    await artifactService.register({
      runId: run.id,
      type: "retro_document",
      title: "Sprint 3 Retrospective Summary",
      format: "markdown",
    })

    // Verify artifact exists
    const artifacts = await artifactRepo.listByRunId(run.id)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].type).toBe("retro_document")

    // === 8. Agent signals completion → run succeeds ===
    // Check that all required artifacts are present
    const completionCheck = await phaseController.handleCompletionCheck(run.id)
    expect(completionCheck.allowed).toBe(true)

    // Transition to succeeded
    await runService.transition(run.id, "succeeded")

    currentRun = await runRepo.getById(run.id)
    expect(currentRun!.status).toBe("succeeded")

    // === 9. Verify complete lifecycle ===

    // Run events should cover the full lifecycle
    const events = await runEventRepo.listByRunId(run.id)
    const eventTypes = events.map((e) => e.eventType)

    expect(eventTypes).toContain("run.created")
    expect(eventTypes).toContain("run.status_changed")
    expect(eventTypes).toContain("phase.entered")
    expect(eventTypes).toContain("approval.requested")
    expect(eventTypes).toContain("artifact.registered")

    // RunSession exists and is linked
    const sessions = await runSessionRepo.listByRunId(run.id)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].session_id).toBe(agentId)

    // Cleanup
    unsubscribe()
    phaseController.cleanup(run.id)
  })

  it("blocks completion when required artifact is missing", async () => {
    const playbook = await playbookService.create({
      name: "Retro",
      description: "Retro",
      goal: "Collect",
      instructions: "Guide",
      artifacts: [{ type: "retro_document" }],
    })

    const harness = await harnessService.create({
      name: "Simple",
      description: "Simple",
      phases: ["work"],
    })

    const run = await compiler.compile({
      playbookId: playbook.id,
      harnessId: harness.id,
      inputs: {},
    })

    // Try to complete without registering artifact
    const check = await phaseController.handleCompletionCheck(run.id)
    expect(check.allowed).toBe(false)
    expect(check.error).toContain("retro_document")
  })

  it("rejects out-of-order phase transitions", async () => {
    const playbook = await playbookService.create({
      name: "Retro",
      description: "Retro",
      goal: "Collect",
      instructions: "Guide",
    })

    const harness = await harnessService.create({
      name: "3-Phase",
      description: "3-Phase",
      phases: ["collect", "analyze", "review"],
    })

    const run = await compiler.compile({
      playbookId: playbook.id,
      harnessId: harness.id,
      inputs: {},
    })

    // Try to skip to review (should fail)
    const result = await phaseController.handlePhaseDeclaration(run.id, "review")
    expect(result.allowed).toBe(false)
    expect(result.error).toContain("cannot enter 'review'")
  })
})
