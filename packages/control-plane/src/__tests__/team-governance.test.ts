/**
 * Plan 004 Gate 3: Governance preserved for team runs
 *
 * Verifies that approval gates and artifact requirements continue to
 * work correctly when runs have a resolved team and multiple sessions.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { RunCompiler, type CompileRunInput } from "../services/run-compiler.js"
import { HandoffService, type HandoffServiceDeps } from "../services/handoff-service.js"
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
import { PlaybookService } from "../services/playbook-service.js"
import { HarnessService } from "../services/harness-service.js"
import type { RoleSpecRecord, TeamSpecRecord, RunRecord } from "../repositories.js"

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
let agentManager: FakeAgentManager
let runService: RunService
let artifactService: ArtifactService
let handoffService: HandoffService
let compiler: RunCompiler
let trackedRuns: Map<string, string>

let analyst: RoleSpecRecord
let researcher: RoleSpecRecord
let writer: RoleSpecRecord
let team: TeamSpecRecord

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

  agentManager = new FakeAgentManager()
  trackedRuns = new Map()

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

  const handoffDeps: HandoffServiceDeps = {
    runRepository: runRepo,
    runEventRepository: runEventRepo,
    runPlanRepository: runPlanRepo,
    runSessionRepository: runSessionRepo,
    roleSpecRepository: roleSpecRepo,
    teamSpecRepository: teamSpecRepo,
    agentManager,
    runtimeAdapter: {
      trackRun(runId: string, agentId: string) {
        trackedRuns.set(runId, agentId)
      },
    },
  }
  handoffService = new HandoffService(handoffDeps)
}

async function createTeamAndRoles() {
  const roleService = new RoleService(roleSpecRepo)
  const teamService = new TeamService(teamSpecRepo, roleSpecRepo)

  researcher = await roleService.create({
    name: "Researcher",
    description: "Gathers information",
  })
  analyst = await roleService.create({
    name: "Analyst",
    description: "Analyzes data",
  })
  writer = await roleService.create({
    name: "Writer",
    description: "Drafts documents",
  })

  team = await teamService.create({
    name: "Retro Team",
    description: "Sprint retro team",
    lead_role: analyst.id,
    roles: [researcher.id, analyst.id, writer.id],
    coordination: { mode: "supervisor-led" },
  })
}

describe("Gate 3: Governance preserved for team runs", () => {
  beforeEach(async () => {
    setupAll()
    await createTeamAndRoles()
  })

  it("required artifact absence prevents a team run from succeeding", async () => {
    const playbookService = new PlaybookService(playbookRepo)
    const harnessService = new HarnessService(harnessRepo, playbookRepo)

    const playbook = await playbookService.create({
      name: "Retro with Artifacts",
      description: "Retro requiring output",
      goal: "Generate retro document",
      instructions: "Collect, analyze, draft",
      artifacts: [
        { type: "retro_document", format: "markdown", description: "Retro output" },
      ],
    })

    const harness = await harnessService.create({
      name: "Standard",
      description: "Standard phases",
      phases: ["collect", "analyze", "review"],
      requirements: { artifact_registration_required: true },
    })

    const run = await compiler.compile({
      playbookId: playbook.id,
      harnessId: harness.id,
      inputs: { topic: "Sprint 3" },
      teamId: team.id,
    })

    // Confirm it's a team run
    expect(run.team).toBe(team.id)
    expect(run.status).toBe("running")

    // Create a handoff to demonstrate multi-session
    await handoffService.createHandoff({
      runId: run.id,
      fromRole: analyst.id,
      toRole: researcher.id,
      summary: "Collect data",
    })

    // Attempt to transition to succeeded without the required artifact
    await expect(
      runService.transition(run.id, "succeeded"),
    ).rejects.toThrow("required artifact missing: retro_document")

    // Verify the run is NOT succeeded
    const updatedRun = await runRepo.getById(run.id)
    expect(updatedRun!.status).not.toBe("succeeded")
  })

  it("team run succeeds when required artifacts are registered", async () => {
    const playbookService = new PlaybookService(playbookRepo)
    const harnessService = new HarnessService(harnessRepo, playbookRepo)

    const playbook = await playbookService.create({
      name: "Retro with Artifacts",
      description: "Retro requiring output",
      goal: "Generate retro document",
      instructions: "Collect, analyze, draft",
      artifacts: [
        { type: "retro_document", format: "markdown" },
      ],
    })

    const harness = await harnessService.create({
      name: "Standard",
      description: "Standard phases",
      phases: ["collect", "analyze", "review"],
    })

    const run = await compiler.compile({
      playbookId: playbook.id,
      harnessId: harness.id,
      inputs: { topic: "Sprint 3" },
      teamId: team.id,
    })

    // Register the required artifact (as if the writer produced it)
    await artifactService.register({
      runId: run.id,
      type: "retro_document",
      title: "Sprint 3 Retrospective",
      format: "markdown",
      producer: { role_id: writer.id },
    })

    // Now the run can succeed
    const succeededRun = await runService.transition(run.id, "succeeded")
    expect(succeededRun.status).toBe("succeeded")
  })

  it("multi-session team run events are reconstructible from durable RunEvents", async () => {
    const playbookService = new PlaybookService(playbookRepo)
    const harnessService = new HarnessService(harnessRepo, playbookRepo)

    const playbook = await playbookService.create({
      name: "Retro",
      description: "Retro task",
      goal: "Do retro",
      instructions: "Steps",
    })
    const harness = await harnessService.create({
      name: "Standard",
      description: "Standard phases",
      phases: ["collect", "analyze"],
    })

    const run = await compiler.compile({
      playbookId: playbook.id,
      harnessId: harness.id,
      inputs: {},
      teamId: team.id,
    })

    // Create two handoffs
    await handoffService.createHandoff({
      runId: run.id,
      fromRole: analyst.id,
      toRole: researcher.id,
      summary: "Collect linear data",
    })
    await handoffService.createHandoff({
      runId: run.id,
      fromRole: analyst.id,
      toRole: writer.id,
      summary: "Draft document",
    })

    // 3 sessions: lead + 2 workers
    const sessions = await runSessionRepo.listByRunId(run.id)
    expect(sessions).toHaveLength(3)

    const roleIds = sessions.map((s) => s.role_id).sort()
    expect(roleIds).toEqual([analyst.id, researcher.id, writer.id].sort())

    // Events show full handoff chain
    const events = await runEventRepo.listByRunId(run.id)
    const handoffCreated = events.filter((e) => e.eventType === "handoff.created")
    const handoffAccepted = events.filter((e) => e.eventType === "handoff.accepted")
    const sessionCreated = events.filter((e) => e.eventType === "session.created")

    expect(handoffCreated).toHaveLength(2)
    expect(handoffAccepted).toHaveLength(2)
    expect(sessionCreated).toHaveLength(2) // 2 worker sessions

    // Each handoff event has from/to role info
    for (const evt of handoffCreated) {
      const payload = evt.payload as Record<string, unknown>
      expect(payload.fromRole).toBeDefined()
      expect(payload.toRole).toBeDefined()
      expect(payload.summary).toBeDefined()
    }
  })
})
