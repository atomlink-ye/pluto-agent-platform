/**
 * Plan 003 Feature 3: Run Compiler — Unit Tests
 */
import { describe, it, expect, beforeEach } from "vitest"
import { RunCompiler, type CompileRunInput } from "../services/run-compiler.js"
import { RunService } from "../services/run-service.js"
import { ArtifactService } from "../services/artifact-service.js"
import { FakeAgentManager } from "../paseo/fake-agent-manager.js"
import {
  InMemoryPlaybookRepository,
  InMemoryHarnessRepository,
  InMemoryRunRepository,
  InMemoryRunEventRepository,
  InMemoryRunPlanRepository,
  InMemoryPolicySnapshotRepository,
  InMemoryRunSessionRepository,
  InMemoryArtifactRepository,
} from "../repositories/in-memory.js"
import type { PlaybookCreateInput, HarnessCreateInput } from "@pluto-agent-platform/contracts"
import { PlaybookService } from "../services/playbook-service.js"
import { HarnessService } from "../services/harness-service.js"

let playbookRepo: InMemoryPlaybookRepository
let harnessRepo: InMemoryHarnessRepository
let runRepo: InMemoryRunRepository
let runEventRepo: InMemoryRunEventRepository
let runPlanRepo: InMemoryRunPlanRepository
let policySnapshotRepo: InMemoryPolicySnapshotRepository
let runSessionRepo: InMemoryRunSessionRepository
let artifactRepo: InMemoryArtifactRepository
let playbookService: PlaybookService
let harnessService: HarnessService
let runService: RunService
let agentManager: FakeAgentManager
let compiler: RunCompiler
let trackedRuns: Map<string, string>

function setupAll() {
  playbookRepo = new InMemoryPlaybookRepository()
  harnessRepo = new InMemoryHarnessRepository()
  runRepo = new InMemoryRunRepository()
  runEventRepo = new InMemoryRunEventRepository()
  runPlanRepo = new InMemoryRunPlanRepository()
  policySnapshotRepo = new InMemoryPolicySnapshotRepository()
  runSessionRepo = new InMemoryRunSessionRepository()
  artifactRepo = new InMemoryArtifactRepository()

  playbookService = new PlaybookService(playbookRepo)
  harnessService = new HarnessService(harnessRepo, playbookRepo)

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
  trackedRuns = new Map()

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
    runtimeAdapter: {
      trackRun(runId: string, agentId: string) {
        trackedRuns.set(runId, agentId)
      },
    },
  })
}

async function createPlaybookAndHarness(
  playbookOverrides: Partial<PlaybookCreateInput> = {},
  harnessOverrides: Partial<HarnessCreateInput> = {},
) {
  const playbook = await playbookService.create({
    name: "Sprint Retro",
    description: "Facilitate a sprint retrospective",
    goal: "Collect team feedback and generate action items",
    instructions: "Guide team through what went well, what didn't, and improvements",
    ...playbookOverrides,
  })

  const harness = await harnessService.create({
    name: "Standard 3-Phase",
    description: "Three-phase execution with approval gates",
    phases: ["collect", "analyze", "review"],
    approvals: { destructive_write: "required" },
    ...harnessOverrides,
  })

  return { playbook, harness }
}

describe("Run Compiler (Plan 003 F3)", () => {
  beforeEach(() => {
    setupAll()
  })

  describe("Scenario 3.1: Successful run compilation", () => {
    it("creates a live Paseo agent session from playbook + harness + inputs", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()

      const input: CompileRunInput = {
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { topic: "Q1 Sprint 3" },
        provider: "claude",
      }

      const run = await compiler.compile(input)

      // Run should be in "running" state
      expect(run.status).toBe("running")
      expect(run.playbook).toBe(playbook.id)
      expect(run.harness).toBe(harness.id)

      // A Paseo agent should have been created
      const agents = agentManager.listAgents()
      expect(agents).toHaveLength(1)

      // RunSession should link the run to the agent
      const sessions = await runSessionRepo.listByRunId(run.id)
      expect(sessions).toHaveLength(1)
      expect(sessions[0].session_id).toBe(agents[0].id)
      expect(sessions[0].status).toBe("active")

      // RunPlan should have 3 phases
      const plan = await runPlanRepo.getByRunId(run.id)
      expect(plan).not.toBeNull()
      expect(plan!.stages).toHaveLength(3)

      // PolicySnapshot should be recorded
      const snapshot = await policySnapshotRepo.getByRunId(run.id)
      expect(snapshot).not.toBeNull()

      // Agent should have been registered for tracking
      expect(trackedRuns.get(run.id)).toBe(agents[0].id)

      // Agent should have received a prompt
      expect(agentManager.runAgentCalls).toHaveLength(1)
    })
  })

  describe("Scenario 3.2: System prompt contains governance context", () => {
    it("includes phase names and approval rules in the agent system prompt", async () => {
      const { playbook, harness } = await createPlaybookAndHarness(
        {
          artifacts: [
            { type: "retro_document", format: "markdown", description: "Sprint retrospective summary" },
          ],
        },
        {
          phases: ["collect", "analyze", "review"],
          approvals: { destructive_write: "required" },
        },
      )

      const input: CompileRunInput = {
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { topic: "Q1 Sprint 3" },
      }

      await compiler.compile(input)

      // Check the agent's system prompt
      const agents = agentManager.listAgents()
      const agentConfig = agents[0].config
      expect(agentConfig.systemPrompt).toBeDefined()

      const prompt = agentConfig.systemPrompt!
      expect(prompt).toContain("collect")
      expect(prompt).toContain("analyze")
      expect(prompt).toContain("review")
      expect(prompt).toContain("destructive_write")
      expect(prompt).toContain("declare_phase")
      expect(prompt).toContain("register_artifact")
      expect(prompt).toContain("retro_document")
    })

    it("passes resolved EnvironmentSpec repositories into the system prompt", async () => {
      const { playbook, harness } = await createPlaybookAndHarness({
        context: {
          repositories: ["monorepo-main"],
        },
      })

      const run = await compiler.compile({
        playbookId: playbook.id,
        harnessId: harness.id,
        workingDirectory: " /tmp/pluto-workspace ",
        inputs: {
          topic: "Q1 Sprint 3",
          environment: {
            id: "env_custom",
            name: "Custom Environment",
            repositories: ["docs-repo"],
            integrations: ["slack"],
            metadata: { owner: "ops" },
          },
        },
      })

      const agentConfig = agentManager.listAgents()[0].config
      const prompt = agentConfig.systemPrompt ?? ""
      expect(prompt).toContain("monorepo-main")
      expect(prompt).toContain("docs-repo")
      expect(agentConfig.cwd).toBe("/tmp/pluto-workspace")

      const storedRun = await runRepo.getById(run.id)
      expect(storedRun?.environment).toBe("env_custom")
      expect(storedRun?.input.environment).toEqual({
        kind: "environment",
        id: "env_custom",
        name: "Custom Environment",
        repositories: ["monorepo-main", "docs-repo"],
        integrations: ["slack"],
        constraints: { workingDirectory: "/tmp/pluto-workspace" },
        metadata: { owner: "ops" },
      })
    })
  })

  describe("Scenario 3.3: Compilation failure is recorded", () => {
    it("transitions run to failed when agent creation fails", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()

      agentManager.shouldFailCreateAgent = true

      const input: CompileRunInput = {
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { topic: "test" },
      }

      await expect(compiler.compile(input)).rejects.toThrow()

      const runs = await runRepo.list()
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe("failed")
    })

    it("sets failure reason on the run", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()

      agentManager.shouldFailCreateAgent = true

      const input: CompileRunInput = {
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { topic: "test" },
      }

      try {
        await compiler.compile(input)
      } catch {
        // expected
      }

      const runs = await runRepo.list()
      expect(runs).toHaveLength(1)
      expect(runs[0].failureReason).toContain("Compilation failed")
      expect(runs[0].failureReason).toContain("Failed to create agent")
      expect(agentManager.listAgents()).toHaveLength(0)
    })

    it("kills the agent and fails the run when RunSession save throws after spawn", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()
      const failingRunSessionRepo = {
        save: async () => {
          throw new Error("RunSession persistence failed")
        },
        getById: runSessionRepo.getById.bind(runSessionRepo),
        listByRunId: runSessionRepo.listByRunId.bind(runSessionRepo),
        update: runSessionRepo.update.bind(runSessionRepo),
      }

      const rollbackCompiler = new RunCompiler({
        ...compiler["deps"],
        runSessionRepository: failingRunSessionRepo,
      })

      await expect(
        rollbackCompiler.compile({
          playbookId: playbook.id,
          harnessId: harness.id,
          inputs: { topic: "rollback" },
        }),
      ).rejects.toThrow("RunSession persistence failed")

      expect(agentManager.killedAgentIds).toHaveLength(1)
      expect(agentManager.listAgents()).toHaveLength(0)

      const runs = await runRepo.list()
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe("failed")
      expect(runs[0].failureReason).toContain("Compilation failed after agent spawn")
      expect(runs[0].failureReason).toContain("RunSession persistence failed")
    })
  })

  describe("Scenario 3.4: Agent is tracked immediately", () => {
    it("registers agent for tracking before runAgent is called", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()

      let trackedAtRunTime = false

      // Override the runtime adapter to check tracking timing
      const customCompiler = new RunCompiler({
        ...compiler["deps"],
        runtimeAdapter: {
          trackRun(runId: string, agentId: string) {
            trackedRuns.set(runId, agentId)
            trackedAtRunTime = true
          },
        },
        agentManager: {
          ...agentManager,
          async runAgent(agentId, prompt, options) {
            // At this point, tracking should already be set up
            expect(trackedAtRunTime).toBe(true)
            return agentManager.runAgent(agentId, prompt, options)
          },
          async createAgent(config, agentId, options) {
            return agentManager.createAgent(config, agentId, options)
          },
          async killAgent(agentId) {
            return agentManager.killAgent(agentId)
          },
          subscribe: agentManager.subscribe.bind(agentManager),
          getAgent: agentManager.getAgent.bind(agentManager),
          listAgents: agentManager.listAgents.bind(agentManager),
        },
      })

      const input: CompileRunInput = {
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { topic: "test" },
      }

      await customCompiler.compile(input)
      expect(trackedAtRunTime).toBe(true)
    })

    it("does not block compilation for a valid merged EnvironmentSpec", async () => {
      const { playbook, harness } = await createPlaybookAndHarness({
        context: {
          repositories: ["monorepo-main"],
        },
      })

      const run = await compiler.compile({
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: {
          topic: "test",
          environment: {
            name: "Merged Environment",
          },
        },
      })

      expect(run.status).toBe("running")
      const storedRun = await runRepo.getById(run.id)
      expect(storedRun?.input.environment).toEqual({
        kind: "environment",
        id: `env_${run.id}`,
        name: "Merged Environment",
        repositories: ["monorepo-main"],
      })
    })
  })
})
