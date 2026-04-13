/**
 * Seed data for development.
 *
 * Creates sample playbooks, harnesses, and runs so the frontend
 * renders meaningful content during development.
 */
import type {
  PlaybookService,
  HarnessService,
  RoleService,
  TeamService,
  RunService,
  ApprovalService,
  ArtifactService,
  RunRepository,
  RunEventRepository,
  RunPlanRepository,
  RunSessionRepository,
} from "@pluto-agent-platform/control-plane"

export interface SeedDeps {
  playbookService: PlaybookService
  harnessService: HarnessService
  roleService?: RoleService
  teamService?: TeamService
  runService: RunService
  approvalService: ApprovalService
  artifactService: ArtifactService
  runRepository?: RunRepository
  runEventRepository?: RunEventRepository
  runPlanRepository?: RunPlanRepository
  runSessionRepository?: RunSessionRepository
}

export async function seedDevData(deps: SeedDeps): Promise<void> {
  const { playbookService, harnessService, runService, approvalService, artifactService } = deps

  // --- Harness: Standard 3-Phase ---
  const harness = await harnessService.create({
    name: "Standard 3-Phase",
    description: "Collect → Analyze → Review with approval gate on review",
    phases: ["collect", "analyze", "review"],
    approvals: {
      production_change: "required",
    },
  })

  // --- Harness: Simple 2-Phase ---
  const simpleHarness = await harnessService.create({
    name: "Simple 2-Phase",
    description: "Implement → Verify",
    phases: ["implement", "verify"],
  })

  // --- Playbook: Sprint Retro ---
  const retroPlaybook = await playbookService.create({
    name: "Sprint Retro",
    description: "Gather team feedback and produce a retrospective document",
    goal: "Collect feedback from the team, analyze themes, and produce a structured retrospective document",
    instructions:
      "Interview each team member about what went well, what didn't, and what to improve. Synthesize into themes and produce a retro document.",
    inputs: [
      { name: "sprint_name", type: "string", required: true, description: "The sprint to review" },
      {
        name: "team_members",
        type: "string",
        required: false,
        description: "Comma-separated list of team members",
      },
    ],
    artifacts: [{ type: "retro_document", format: "markdown" }],
    quality_bar: ["completeness", "actionable recommendations"],
  })

  // Attach harness to playbook
  await harnessService.attachToPlaybook(harness.id, retroPlaybook.id)

  // --- Playbook: Code Review ---
  const reviewPlaybook = await playbookService.create({
    name: "Code Review",
    description: "Automated code review with quality analysis",
    goal: "Review the submitted pull request for correctness, style, and security issues",
    instructions:
      "Read the diff, identify issues, categorize by severity, and produce a review summary.",
    inputs: [
      { name: "pr_url", type: "string", required: true, description: "URL of the pull request" },
      {
        name: "focus_areas",
        type: "string",
        required: false,
        description: "Specific areas to focus on",
      },
    ],
    artifacts: [{ type: "review_summary", format: "markdown" }],
    quality_bar: ["thoroughness", "actionable feedback"],
  })

  await harnessService.attachToPlaybook(simpleHarness.id, reviewPlaybook.id)

  // --- Playbook: Data Migration (no harness) ---
  await playbookService.create({
    name: "Data Migration",
    description: "Schema migration planning for database changes",
    goal: "Analyze the target schema, produce a migration plan, and execute safely",
    instructions: "Compare current and target schemas. Produce a migration script and rollback plan.",
  })

  // --- Runs ---
  // Run 1: succeeded sprint retro
  const run1 = await runService.create(retroPlaybook.id, harness.id, {
    sprint_name: "Sprint 42",
    team_members: "Alice, Bob, Charlie",
  })
  await runService.transition(run1.id, "initializing")
  await runService.transition(run1.id, "running")

  // Register artifact so it can succeed
  await artifactService.register({
    runId: run1.id,
    type: "retro_document",
    title: "Sprint 42 Retrospective",
    format: "markdown",
  })
  await runService.transition(run1.id, "succeeded")

  // Run 2: waiting approval
  const run2 = await runService.create(retroPlaybook.id, harness.id, {
    sprint_name: "Sprint 43",
  })
  await runService.transition(run2.id, "initializing")
  await runService.transition(run2.id, "running")

  // Create an approval task for run2
  await approvalService.createApproval({
    runId: run2.id,
    actionClass: "production_change",
    title: "Review phase approval",
    requestedBy: {
      source: "system",
      role_id: "operator",
    },
    context: { phase: "review", reason: "Entering review phase requires operator approval" },
  })

  // Run 3: running code review
  const run3 = await runService.create(reviewPlaybook.id, simpleHarness.id, {
    pr_url: "https://github.com/example/repo/pull/123",
    focus_areas: "security, error handling",
  })
  await runService.transition(run3.id, "initializing")
  await runService.transition(run3.id, "running")

  // Run 4: failed run
  const run4 = await runService.create(retroPlaybook.id, harness.id, {
    sprint_name: "Sprint 41",
  })
  await runService.transition(run4.id, "initializing")
  await runService.transition(run4.id, "running")
  await runService.transition(run4.id, "failed", {
    failureReason: "Agent process crashed unexpectedly",
  })

  // --- Team Orchestration Seed ---
  if (deps.roleService && deps.teamService && deps.runRepository && deps.runEventRepository && deps.runPlanRepository && deps.runSessionRepository) {
    const researcherRole = await deps.roleService.create({
      name: "Researcher",
      description: "Gathers information from Linear, Slack, and documents",
      system_prompt: "You are a research specialist. Focus on gathering comprehensive data.",
    })
    const analystRole = await deps.roleService.create({
      name: "Analyst",
      description: "Analyzes gathered data and identifies themes",
      system_prompt: "You are an analytical specialist. Identify patterns and themes.",
    })
    const writerRole = await deps.roleService.create({
      name: "Writer",
      description: "Drafts documents based on analysis results",
    })

    const retroTeam = await deps.teamService.create({
      name: "Sprint Retro Team",
      description: "Specialized team for retrospective facilitation",
      lead_role: analystRole.id,
      roles: [researcherRole.id, analystRole.id, writerRole.id],
      coordination: { mode: "supervisor-led" },
    })

    // Run 5: team run with handoff events (simulated)
    const run5 = await runService.create(retroPlaybook.id, harness.id, {
      sprint_name: "Sprint 44 (Team Run)",
    })
    await deps.runRepository.update({
      ...run5,
      team: retroTeam.id,
      updatedAt: new Date().toISOString(),
    })
    await runService.transition(run5.id, "initializing")
    await runService.transition(run5.id, "running")

    // Add lead session with role
    const leadSessionId = `sess_lead_${run5.id.slice(4, 12)}`
    await deps.runSessionRepository.save({
      kind: "run_session",
      id: leadSessionId,
      run_id: run5.id,
      session_id: `paseo_lead_${run5.id.slice(4, 12)}`,
      role_id: analystRole.id,
      provider: "claude",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Add worker session
    const workerSessionId = `sess_worker_${run5.id.slice(4, 12)}`
    await deps.runSessionRepository.save({
      kind: "run_session",
      id: workerSessionId,
      run_id: run5.id,
      session_id: `paseo_worker_${run5.id.slice(4, 12)}`,
      role_id: researcherRole.id,
      provider: "claude",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // Add handoff events
    const now = new Date().toISOString()
    await deps.runEventRepository.append({
      id: `evt_hoff_created_${run5.id.slice(4, 12)}`,
      runId: run5.id,
      eventType: "handoff.created",
      occurredAt: now,
      source: "orchestrator",
      payload: {
        fromRole: analystRole.id,
        toRole: researcherRole.id,
        summary: "Collect Linear issues and Slack threads for Sprint 44",
      },
    })
    await deps.runEventRepository.append({
      id: `evt_hoff_accepted_${run5.id.slice(4, 12)}`,
      runId: run5.id,
      eventType: "handoff.accepted",
      occurredAt: now,
      source: "orchestrator",
      payload: {
        fromRole: analystRole.id,
        toRole: researcherRole.id,
      },
    })

    // Update RunPlan with role assignments
    const plan5 = await deps.runPlanRepository.getByRunId(run5.id)
    if (plan5) {
      await deps.runPlanRepository.save({
        ...plan5,
        stages: [
          ...plan5.stages.map((s) => ({ ...s, role: analystRole.id })),
          {
            id: `stage_handoff_researcher`,
            phase: plan5.current_phase ?? "collect",
            role: researcherRole.id,
            status: "running",
          },
        ],
      })
    }

    console.log(`  Roles: Researcher, Analyst, Writer`)
    console.log(`  Teams: Sprint Retro Team`)
    console.log(`  Team Run: Sprint 44 with handoff (analyst → researcher)`)
  }

  console.log("Seed data created:")
  console.log(`  Playbooks: Sprint Retro, Code Review, Data Migration`)
  console.log(`  Harnesses: Standard 3-Phase, Simple 2-Phase`)
  console.log(`  Runs: succeeded, waiting_approval, running, failed`)
}
