/**
 * Plan 004 Feature 3: Team-aware Run Compiler — Unit Tests
 *
 * Tests supervisor-led team run compilation, including team resolution,
 * lead role tagging, RunPlan role assignment, and system prompt team context.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { RunCompiler, type CompileRunInput } from "../services/run-compiler.js"
import { RunService } from "../services/run-service.js"
import { ArtifactService } from "../services/artifact-service.js"
import { RoleService } from "../services/role-service.js"
import { TeamService } from "../services/team-service.js"
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
  InMemoryRoleSpecRepository,
  InMemoryTeamSpecRepository,
} from "../repositories/in-memory.js"
import type { PlaybookCreateInput, HarnessCreateInput } from "@pluto-agent-platform/contracts"
import { PlaybookService } from "../services/playbook-service.js"
import { HarnessService } from "../services/harness-service.js"
import type { RoleSpecRecord, TeamSpecRecord } from "../repositories.js"

let playbookRepo: InMemoryPlaybookRepository
let harnessRepo: InMemoryHarnessRepository
let runRepo: InMemoryRunRepository
let runEventRepo: InMemoryRunEventRepository
let runPlanRepo: InMemoryRunPlanRepository
let policySnapshotRepo: InMemoryPolicySnapshotRepository
let runSessionRepo: InMemoryRunSessionRepository
let artifactRepo: InMemoryArtifactRepository
let roleSpecRepo: InMemoryRoleSpecRepository
let teamSpecRepo: InMemoryTeamSpecRepository
let playbookService: PlaybookService
let harnessService: HarnessService
let roleService: RoleService
let teamService: TeamService
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
  roleSpecRepo = new InMemoryRoleSpecRepository()
  teamSpecRepo = new InMemoryTeamSpecRepository()

  playbookService = new PlaybookService(playbookRepo)
  harnessService = new HarnessService(harnessRepo, playbookRepo)
  roleService = new RoleService(roleSpecRepo)
  teamService = new TeamService(teamSpecRepo, roleSpecRepo)

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
    roleSpecRepository: roleSpecRepo,
    teamSpecRepository: teamSpecRepo,
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

async function createTeamWithRoles(): Promise<{
  roles: RoleSpecRecord[]
  team: TeamSpecRecord
}> {
  const researcher = await roleService.create({
    name: "Researcher",
    description: "Gathers information from various sources",
    system_prompt: "You are a research specialist.",
  })

  const analyst = await roleService.create({
    name: "Analyst",
    description: "Analyzes gathered data and identifies patterns",
    system_prompt: "You are an analytical specialist.",
  })

  const writer = await roleService.create({
    name: "Writer",
    description: "Drafts documents based on analysis",
  })

  const team = await teamService.create({
    name: "Retro Team",
    description: "Sprint retrospective team",
    lead_role: analyst.id,
    roles: [researcher.id, analyst.id, writer.id],
    coordination: { mode: "supervisor-led" },
  })

  return { roles: [researcher, analyst, writer], team }
}

describe("Team-aware Run Compiler (Plan 004 F3)", () => {
  beforeEach(() => {
    setupAll()
  })

  describe("Scenario 3.1: Generate initial team run plan", () => {
    it("creates a team run with resolved team, lead session, and role-assigned stages", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()
      const { team, roles } = await createTeamWithRoles()
      const analyst = roles[1]

      const input: CompileRunInput = {
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { topic: "Q1 Sprint 3" },
        teamId: team.id,
      }

      const run = await compiler.compile(input)

      // Run should be in "running" state with team recorded
      expect(run.status).toBe("running")
      expect(run.team).toBe(team.id)

      // Lead RunSession should be tagged with lead role
      const sessions = await runSessionRepo.listByRunId(run.id)
      expect(sessions).toHaveLength(1)
      expect(sessions[0].role_id).toBe(analyst.id)
      expect(sessions[0].status).toBe("active")

      // RunPlan stages should have role assignments
      const plan = await runPlanRepo.getByRunId(run.id)
      expect(plan).not.toBeNull()
      expect(plan!.stages).toHaveLength(3)
      for (const stage of plan!.stages) {
        expect(stage.role).toBe(analyst.id)
      }
    })

    it("includes team context in the agent system prompt", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()
      const { team } = await createTeamWithRoles()

      await compiler.compile({
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { topic: "test" },
        teamId: team.id,
      })

      const agents = agentManager.listAgents()
      const prompt = agents[0].config.systemPrompt ?? ""

      // Team section
      expect(prompt).toContain("## Team")
      expect(prompt).toContain("Analyst")
      expect(prompt).toContain("Researcher")
      expect(prompt).toContain("Writer")
      expect(prompt).toContain("Lead Role:")

      // Delegation section
      expect(prompt).toContain("## Delegation")
      expect(prompt).toContain("create_handoff")

      // Handoff MCP tools documented
      expect(prompt).toContain("### create_handoff")
      expect(prompt).toContain("### reject_handoff")
      expect(prompt).toContain('"fromRole": "role_')
    })

    it("names the agent title with the lead role", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()
      const { team } = await createTeamWithRoles()

      await compiler.compile({
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { topic: "test" },
        teamId: team.id,
      })

      const agents = agentManager.listAgents()
      expect(agents[0].config.title).toContain("Analyst")
    })
  })

  describe("Backward compatibility", () => {
    it("compiles a single-agent run without team (no role tagging, no team prompt)", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()

      const input: CompileRunInput = {
        playbookId: playbook.id,
        harnessId: harness.id,
        inputs: { topic: "Q1 Sprint 3" },
      }

      const run = await compiler.compile(input)

      // No team on run
      expect(run.team).toBeUndefined()

      // No role_id on session
      const sessions = await runSessionRepo.listByRunId(run.id)
      expect(sessions).toHaveLength(1)
      expect(sessions[0].role_id).toBeUndefined()

      // No team context in prompt
      const agents = agentManager.listAgents()
      const prompt = agents[0].config.systemPrompt ?? ""
      expect(prompt).not.toContain("## Team")
      expect(prompt).not.toContain("## Delegation")
      expect(prompt).not.toContain("create_handoff")

      // RunPlan stages have no role
      const plan = await runPlanRepo.getByRunId(run.id)
      for (const stage of plan!.stages) {
        expect(stage.role).toBeUndefined()
      }
    })
  })

  describe("Team resolution validation", () => {
    it("throws when teamId references a non-existent team", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()

      await expect(
        compiler.compile({
          playbookId: playbook.id,
          harnessId: harness.id,
          inputs: { topic: "test" },
          teamId: "nonexistent",
        }),
      ).rejects.toThrow("Team not found: nonexistent")
    })

    it("throws when team has no lead_role", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()
      const role = await roleService.create({
        name: "Worker",
        description: "A worker role",
      })

      // Directly save a team without lead_role to bypass TeamService validation
      await teamSpecRepo.save({
        kind: "team",
        id: "team_no_lead",
        name: "No Lead Team",
        description: "Team without a lead",
        roles: [role.id],
        coordination: { mode: "supervisor-led" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      await expect(
        compiler.compile({
          playbookId: playbook.id,
          harnessId: harness.id,
          inputs: { topic: "test" },
          teamId: "team_no_lead",
        }),
      ).rejects.toThrow("no lead_role defined")
    })

    it("throws when team references a non-existent role", async () => {
      const { playbook, harness } = await createPlaybookAndHarness()
      const role = await roleService.create({
        name: "Existing",
        description: "An existing role",
      })

      await teamSpecRepo.save({
        kind: "team",
        id: "team_bad_ref",
        name: "Bad Ref Team",
        description: "Team with bad role ref",
        lead_role: role.id,
        roles: [role.id, "ghost_role"],
        coordination: { mode: "supervisor-led" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      await expect(
        compiler.compile({
          playbookId: playbook.id,
          harnessId: harness.id,
          inputs: { topic: "test" },
          teamId: "team_bad_ref",
        }),
      ).rejects.toThrow("Role not found: ghost_role")
    })
  })
})
