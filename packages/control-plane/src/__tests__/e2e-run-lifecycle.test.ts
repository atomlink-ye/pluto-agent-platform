/**
 * E2E Run Lifecycle Test
 *
 * Validates the minimum reference scenario end to end.
 */
import { beforeEach, describe, expect, it } from "vitest"

import { ApprovalService } from "../services/approval-service.js"
import { ArtifactService } from "../services/artifact-service.js"
import { HarnessService } from "../services/harness-service.js"
import { PhaseController } from "../services/phase-controller.js"
import { PlaybookService } from "../services/playbook-service.js"
import { RecoveryService } from "../services/recovery-service.js"
import { RunCompiler } from "../services/run-compiler.js"
import { RunService } from "../services/run-service.js"
import { RuntimeAdapter } from "../services/runtime-adapter.js"
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

let playbookService: PlaybookService
let harnessService: HarnessService
let artifactService: ArtifactService
let runService: RunService
let approvalService: ApprovalService
let agentManager: FakeAgentManager
let runtimeAdapter: RuntimeAdapter
let phaseController: PhaseController
let recoveryService: RecoveryService
let runCompiler: RunCompiler

const waitForAsyncEvents = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 25))
}

const emitToolCall = async (
  agentId: string,
  name: "declare_phase" | "register_artifact",
  input: Record<string, unknown>,
  seq: number,
): Promise<void> => {
  agentManager.emit(
    agentId,
    {
      type: "timeline",
      provider: "claude",
      item: {
        type: "tool_call",
        name,
        input,
      },
    },
    seq,
    "epoch_e2e",
  )
  await waitForAsyncEvents()
}

const getPayloadString = (
  payload: unknown,
  key: string,
): string | undefined => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined
  }

  const value = (payload as Record<string, unknown>)[key]
  return typeof value === "string" ? value : undefined
}

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

  runtimeAdapter = new RuntimeAdapter(
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
    runtimeAdapter,
    phaseController,
    agentManager,
  })

  runCompiler = new RunCompiler({
    playbookRepository: playbookRepo,
    harnessRepository: harnessRepo,
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    runPlanRepository: runPlanRepo,
    policySnapshotRepository: policySnapshotRepo,
    runSessionRepository: runSessionRepo,
    runService,
    agentManager,
    runtimeAdapter,
  })
}

describe("E2E: Full run lifecycle", () => {
  beforeEach(() => {
    setupAll()
  })

  it("validates the full run lifecycle end to end", async () => {
    let runId: string | undefined
    const unsubscribe = runtimeAdapter.start()

    try {
      const playbook = await playbookService.create({
        name: "Sprint retrospective",
        description: "Facilitate a sprint retrospective",
        goal: "Produce a retrospective document",
        instructions: "Collect feedback, analyze it, and prepare a final review",
        artifacts: [{ type: "retro_document", format: "markdown" }],
      })

      const harness = await harnessService.create({
        name: "Governed review harness",
        description: "Three phases with approval before review",
        phases: ["collect", "analyze", "review"],
        approvals: { destructive_write: "required" },
      })

      await harnessService.attachToPlaybook(harness.id, playbook.id)

      const compiledRun = await runCompiler.compile({
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { sprint: "Q1 Sprint 3" },
        provider: "claude",
      })
      runId = compiledRun.id

      expect(compiledRun.status).toBe("running")

      const agents = agentManager.listAgents()
      expect(agents).toHaveLength(1)
      const agentId = agents[0].id

      const recoveryResult = await recoveryService.recoverRun(compiledRun.id)
      expect(recoveryResult).toBe("recovered")

      agentManager.emit(
        agentId,
        {
          type: "thread_started",
          sessionId: "runtime_session_1",
          provider: "claude",
        },
        1,
        "epoch_e2e",
      )
      agentManager.emit(
        agentId,
        {
          type: "turn_started",
          provider: "claude",
          turnId: "turn_collect",
          phase: "collect",
        },
        2,
        "epoch_e2e",
      )
      await waitForAsyncEvents()

      await emitToolCall(agentId, "declare_phase", { phase: "collect" }, 3)

      let currentRun = await runRepo.getById(compiledRun.id)
      expect(currentRun?.current_phase).toBe("collect")
      expect(currentRun?.status).toBe("running")

      const analyzeTransition = await phaseController.handlePhaseDeclaration(
        compiledRun.id,
        "analyze",
      )
      expect(analyzeTransition.allowed).toBe(true)
      await emitToolCall(agentId, "declare_phase", { phase: "analyze" }, 4)

      currentRun = await runRepo.getById(compiledRun.id)
      expect(currentRun?.current_phase).toBe("analyze")
      expect(currentRun?.status).toBe("running")

      const reviewTransition = await phaseController.handlePhaseDeclaration(
        compiledRun.id,
        "review",
      )
      expect(reviewTransition.allowed).toBe(true)
      await emitToolCall(agentId, "declare_phase", { phase: "review" }, 5)

      currentRun = await runRepo.getById(compiledRun.id)
      expect(currentRun?.current_phase).toBe("review")
      expect(currentRun?.status).toBe("waiting_approval")

      const waitingApprovalRecovery = await recoveryService.recoverRun(compiledRun.id)
      expect(waitingApprovalRecovery).toBe("waiting_approval")

      const approvals = await approvalRepo.listByRunId(compiledRun.id)
      const pendingApproval = approvals.find((approval) => approval.status === "pending")

      expect(pendingApproval).toBeDefined()
      expect(pendingApproval).toEqual(
        expect.objectContaining({
          action_class: "destructive_write",
          status: "pending",
        }),
      )

      await approvalService.resolve(
        pendingApproval!.id,
        "approved",
        "operator_1",
        "Approved to continue",
      )
      await phaseController.handleApprovalResolution(
        compiledRun.id,
        pendingApproval!.id,
        "approved",
      )

      currentRun = await runRepo.getById(compiledRun.id)
      expect(currentRun?.status).toBe("running")
      expect(
        agentManager.runAgentCalls.some(
          ({ prompt }) => typeof prompt === "string" && prompt.includes("Approval granted"),
        ),
      ).toBe(true)

      await emitToolCall(
        agentId,
        "register_artifact",
        {
          type: "retro_document",
          title: "Sprint 3 retrospective",
          format: "markdown",
        },
        6,
      )
      await artifactService.register({
        runId: compiledRun.id,
        type: "retro_document",
        title: "Sprint 3 retrospective",
        format: "markdown",
        producer: { session_id: agentId },
      })

      const artifacts = await artifactRepo.listByRunId(compiledRun.id)
      expect(artifacts).toHaveLength(1)
      expect(artifacts[0]).toEqual(
        expect.objectContaining({
          run_id: compiledRun.id,
          type: "retro_document",
        }),
      )

      agentManager.emit(
        agentId,
        {
          type: "turn_completed",
          provider: "claude",
          turnId: "turn_review",
          phase: "review",
          usage: { inputTokens: 100, outputTokens: 50 },
        },
        7,
        "epoch_e2e",
      )
      agentManager.emit(
        agentId,
        {
          type: "attention_required",
          provider: "claude",
          reason: "finished",
          timestamp: new Date().toISOString(),
        },
        8,
        "epoch_e2e",
      )
      await waitForAsyncEvents()

      const finalRun = await runRepo.getById(compiledRun.id)
      expect(finalRun?.status).toBe("succeeded")

      const sessions = await runSessionRepo.listByRunId(compiledRun.id)
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toEqual(
        expect.objectContaining({
          run_id: compiledRun.id,
          session_id: agentId,
          status: "active",
        }),
      )

      const events = await runEventRepo.listByRunId(compiledRun.id)
      const eventTypes = events.map((event) => event.eventType)
      expect(eventTypes).toEqual(
        expect.arrayContaining([
          "run.created",
          "run.status_changed",
          "session.created",
          "stage.started",
          "stage.completed",
          "phase.entered",
          "approval.requested",
          "approval.resolved",
          "artifact.created",
          "artifact.registered",
          "run.completed",
        ]),
      )

      const enteredPhases = events
        .filter((event) => event.eventType === "phase.entered")
        .map((event) => getPayloadString(event.payload, "phase"))
        .filter((phase): phase is string => phase !== undefined)

      expect(new Set(enteredPhases)).toEqual(
        new Set(["collect", "analyze", "review"]),
      )

      const statusChain = events
        .filter((event) => event.eventType === "run.status_changed")
        .map((event) => getPayloadString(event.payload, "toStatus"))
        .filter((status): status is string => status !== undefined)

      expect(statusChain).toEqual([
        "initializing",
        "running",
        "waiting_approval",
        "running",
        "succeeded",
      ])
    } finally {
      unsubscribe()
      if (runId) {
        phaseController.cleanup(runId)
      }
    }
  })
})
