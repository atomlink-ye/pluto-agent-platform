/**
 * Run Compiler — Plan 003 Feature 3
 *
 * Compiles a run from playbook + harness + inputs into a live Paseo agent session.
 * Follows the 11-step compilation sequence from the plan.
 */
import { randomUUID } from "node:crypto"
import type { EnvironmentSpec } from "@pluto-agent-platform/contracts"
import type {
  PlaybookRecord,
  HarnessRecord,
  RunRecord,
  PlaybookRepository,
  HarnessRepository,
  RunRepository,
  RunEventRepository,
  RunPlanRepository,
  PolicySnapshotRepository,
  RunSessionRecord,
  RunSessionRepository,
  RoleSpecRecord,
  RoleSpecRepository,
  TeamSpecRecord,
  TeamSpecRepository,
} from "../repositories.js"
import type { RunService } from "./run-service.js"
import type { AgentManager, AgentSessionConfig } from "../paseo/types.js"
import type { PhaseController } from "./phase-controller.js"

export interface RuntimeAdapterRegistry {
  trackRun(runId: string, agentId: string): void
}

export interface RunCompilerDeps {
  playbookRepository: PlaybookRepository
  harnessRepository: HarnessRepository
  runRepository: RunRepository
  runEventRepository: RunEventRepository
  runPlanRepository: RunPlanRepository
  policySnapshotRepository: PolicySnapshotRepository
  runSessionRepository: RunSessionRepository
  roleSpecRepository?: RoleSpecRepository
  teamSpecRepository?: TeamSpecRepository
  runService: RunService
  agentManager: AgentManager
  runtimeAdapter: RuntimeAdapterRegistry
  phaseController?: Pick<PhaseController, "registerRunAgent">
}

export interface CompileRunInput {
  playbookId: string
  harnessId: string
  inputs: Record<string, unknown>
  provider?: string
  workingDirectory?: string
  teamId?: string
}

export interface ResolvedTeam {
  team: TeamSpecRecord
  roles: Map<string, RoleSpecRecord>
  leadRole: RoleSpecRecord
}

interface ResolvedRunEnvironment {
  spec: EnvironmentSpec
  workingDirectory: string
}

export class RunCompiler {
  constructor(private readonly deps: RunCompilerDeps) {}

  async compile(input: CompileRunInput): Promise<RunRecord> {
    let run: RunRecord | null = null

    try {
      // Step 1: Validate playbook + harness + inputs
      const playbook = await this.deps.playbookRepository.getById(input.playbookId)
      if (!playbook) throw new Error(`Playbook not found: ${input.playbookId}`)

      const harness = await this.deps.harnessRepository.getById(input.harnessId)
      if (!harness) throw new Error(`Harness not found: ${input.harnessId}`)

      // Step 1b: Resolve team if teamId is provided
      const resolvedTeam = input.teamId
        ? await this.resolveTeam(input.teamId)
        : undefined

      // Step 2: Create run with status "queued"
      run = await this.deps.runService.create(
        input.playbookId,
        input.harnessId,
        input.inputs,
      )

      // Step 2b: Transition to "initializing"
      run = await this.deps.runService.transition(run.id, "initializing")

      // Step 2c: Record resolved team on the Run
      if (resolvedTeam) {
        run = await this.deps.runRepository.update({
          ...run,
          team: resolvedTeam.team.id,
          updatedAt: new Date().toISOString(),
        })
      }

      // Step 2d: Update RunPlan with role assignments for team runs
      if (resolvedTeam) {
        const plan = await this.deps.runPlanRepository.getByRunId(run.id)
        if (!plan) {
          throw new Error(`RunPlan not found: ${run.id}`)
        }

        const updatedPlan = {
          ...plan,
          stages: plan.stages.map((stage) => ({
            ...stage,
            role: stage.role ?? resolvedTeam.leadRole.id,
          })),
        }
        await this.deps.runPlanRepository.save(updatedPlan)
      }

      const resolvedEnvironment = resolveEnvironmentSpec({
        playbook,
        run,
        inputs: input.inputs,
        workingDirectory: input.workingDirectory,
      })
      run = await persistResolvedEnvironment(this.deps.runRepository, run, resolvedEnvironment.spec)

      // Step 3: Policy snapshot already created by runService.create()
      // Step 4: Run plan already created by runService.create()

      // Step 5: Construct agent system prompt
      const systemPrompt = buildSystemPrompt(
        playbook,
        harness,
        run.id,
        resolvedEnvironment.spec,
        resolvedTeam,
      )

      // Step 6: Create Paseo agent
      const agentConfig: AgentSessionConfig = {
        provider: input.provider ?? "claude",
        cwd: resolvedEnvironment.workingDirectory,
        systemPrompt,
        title: resolvedTeam
          ? `Run: ${playbook.name} [${resolvedTeam.leadRole.name}]`
          : `Run: ${playbook.name}`,
        mcpServers: buildMcpServers(),
      }

      const agent = await this.deps.agentManager.createAgent(agentConfig)
      const persistenceHandle = this.deps.agentManager.getAgent?.(agent.id)?.persistence?.sessionId
        ?? agent.persistence?.sessionId

      try {
        // Step 7: Register agent in Runtime Adapter tracking
        this.deps.runtimeAdapter.trackRun(run.id, agent.id)
        this.deps.phaseController?.registerRunAgent(run.id, agent.id)

        // Step 8: Create RunSession linking run to Paseo agent
        const sessionRecord: RunSessionRecord = {
          kind: "run_session",
          id: `sess_${randomUUID()}`,
          run_id: run.id,
          session_id: agent.id,
          persistence_handle: persistenceHandle,
          role_id: resolvedTeam?.leadRole.id,
          provider: agentConfig.provider,
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        await this.deps.runSessionRepository.save(sessionRecord)

        // Step 9: Start the agent with initial prompt
        const initialPrompt = buildInitialPrompt(playbook, run.input)
        // Fire and forget — the runtime adapter will track events
        this.deps.agentManager
          .runAgent(agent.id, initialPrompt)
          .catch(() => {
            // Errors will be caught by the runtime adapter via events
          })

        // Step 10: Transition to "running"
        run = await this.deps.runService.transition(run.id, "running")
      } catch (error) {
        run = await this.rollbackSpawnedAgent(run, agent.id, error)
        throw error
      }

      return run
    } catch (error) {
      if (run && run.status !== "failed") {
        try {
          run = await this.deps.runService.transition(run.id, "failed", {
            failureReason: `Compilation failed: ${error instanceof Error ? error.message : String(error)}`,
          })
        } catch {
          // If transition itself fails, we can't do much
        }
      }
      throw error
    }
  }

  private async resolveTeam(teamId: string): Promise<ResolvedTeam> {
    if (!this.deps.teamSpecRepository) {
      throw new Error("Team compilation requires teamSpecRepository")
    }

    if (!this.deps.roleSpecRepository) {
      throw new Error("Team compilation requires roleSpecRepository")
    }

    const team = await this.deps.teamSpecRepository.getById(teamId)
    if (!team) throw new Error(`Team not found: ${teamId}`)

    if (!team.lead_role) {
      throw new Error(`Team ${teamId} has no lead_role defined`)
    }

    const mode = team.coordination?.mode ?? "supervisor-led"
    if (mode !== "supervisor-led") {
      throw new Error(`Unsupported coordination mode: ${mode}. Only supervisor-led is supported in Phase 2`)
    }

    const roles = new Map<string, RoleSpecRecord>()
    for (const roleId of team.roles) {
      const role = await this.deps.roleSpecRepository.getById(roleId)
      if (!role) throw new Error(`Role not found: ${roleId} (referenced by team ${teamId})`)
      roles.set(roleId, role)
    }

    const leadRole = roles.get(team.lead_role)
    if (!leadRole) {
      throw new Error(`Lead role ${team.lead_role} not found in resolved roles for team ${teamId}`)
    }

    return { team, roles, leadRole }
  }

  private async rollbackSpawnedAgent(
    run: RunRecord,
    agentId: string,
    error: unknown,
  ): Promise<RunRecord> {
    let cleanupFailure: string | undefined

    try {
      await this.deps.agentManager.killAgent(agentId)
    } catch (killError) {
      cleanupFailure = killError instanceof Error ? killError.message : String(killError)
    }

    const baseReason = `Compilation failed after agent spawn: ${error instanceof Error ? error.message : String(error)}`
    const failureReason = cleanupFailure
      ? `${baseReason}. Agent cleanup failed: ${cleanupFailure}`
      : baseReason

    return this.deps.runService.transition(run.id, "failed", { failureReason })
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  playbook: PlaybookRecord,
  harness: HarnessRecord,
  runId: string,
  environment: EnvironmentSpec,
  resolvedTeam?: ResolvedTeam,
): string {
  const sections: string[] = []

  sections.push(`# Task: ${playbook.name}`)
  sections.push(`## Goal\n${playbook.goal}`)
  sections.push(`## Instructions\n${playbook.instructions}`)

  if (environment.repositories?.length) {
    sections.push(`## Repositories\n${environment.repositories.join("\n")}`)
  }

  // Team context for supervisor-led runs
  if (resolvedTeam) {
    const roleList = resolvedTeam.team.roles
      .map((roleId) => resolvedTeam.roles.get(roleId))
      .filter((role): role is RoleSpecRecord => role !== undefined)
      .map((role) => `- **${role.name}** (\`${role.id}\`): ${role.description}`)
      .join("\n")

    const teamLines = [
      `Name: ${resolvedTeam.team.name}`,
      `Description: ${resolvedTeam.team.description}`,
      `Lead Role: \`${resolvedTeam.leadRole.id}\` (${resolvedTeam.leadRole.name})`,
      `Coordination Mode: ${resolvedTeam.team.coordination?.mode ?? "supervisor-led"}`,
      "Available team roles:",
      roleList,
    ]

    if (resolvedTeam.leadRole.system_prompt) {
      teamLines.push("", "### Lead Role Guidance", resolvedTeam.leadRole.system_prompt)
    }

    sections.push(`## Team\n${teamLines.join("\n")}`)
    sections.push(`## Delegation\nYou are the lead role for this run. Use the \`create_handoff\` MCP tool to delegate work to another available role. Use the \`reject_handoff\` MCP tool to reject a handoff that should not proceed.`)
  }

  // Harness governance context
  sections.push(`## Execution Governance`)
  sections.push(`### Phases\nYou must progress through these phases in order: ${harness.phases.join(" → ")}`)
  sections.push(`To transition to the next phase, call the \`declare_phase\` MCP tool.`)

  if (harness.approvals) {
    const approvalRules = Object.entries(harness.approvals)
      .filter(([, value]) => value === "required")
      .map(([key]) => key)
    if (approvalRules.length > 0) {
      sections.push(`### Approval Rules\nThe following action classes require approval: ${approvalRules.join(", ")}`)
    }
  }

  if (playbook.artifacts?.length) {
    sections.push(`### Required Artifacts`)
    for (const artifact of playbook.artifacts) {
      sections.push(`- Type: ${artifact.type}${artifact.format ? ` (format: ${artifact.format})` : ""}${artifact.description ? ` — ${artifact.description}` : ""}`)
    }
    sections.push(`Register artifacts using the \`register_artifact\` MCP tool.`)
  }

  // MCP tool documentation
  sections.push(`## Available Control-Plane MCP Tools`)
  sections.push(`### declare_phase\nDeclares transition to the next execution phase.\nParameters: { "runId": "${runId}", "phase": "<phase_name>" }`)
  sections.push(`### register_artifact\nRegisters a deliverable produced during execution.\nParameters: { "runId": "${runId}", "type": "<artifact_type>", "title": "<title>", "format": "<format>" }`)

  if (resolvedTeam) {
    sections.push(`### create_handoff\nDelegates work to another team role. A worker session is spawned when accepted.\nParameters: { "runId": "${runId}", "fromRole": "${resolvedTeam.leadRole.id}", "toRole": "<role_id>", "summary": "<work_description>", "context": "<optional_context>" }`)
    sections.push(`### reject_handoff\nRejects a pending handoff request.\nParameters: { "handoff_id": "<handoff_id>", "reason": "<rejection_reason>" }`)
  }

  sections.push(`### resume_run\nResumes a run after daemon restart by recovering its runtime session.\nParameters: { "runId": "${runId}" }`)

  return sections.join("\n\n")
}

function buildInitialPrompt(
  playbook: PlaybookRecord,
  inputs: Record<string, unknown>,
): string {
  const parts: string[] = []
  parts.push(`Begin executing the task "${playbook.name}".`)

  if (Object.keys(inputs).length > 0) {
    parts.push(`\nInputs:`)
    for (const [key, value] of Object.entries(inputs)) {
      parts.push(`- ${key}: ${JSON.stringify(value)}`)
    }
  }

  parts.push(`\nStart with the first phase: ${playbook.artifacts?.length ? "Ensure all required artifacts are registered before completing." : "Proceed through all phases."}`)

  return parts.join("\n")
}

function buildMcpServers(): Record<string, { command: string; args?: string[] }> {
  // Control-plane MCP tools will be provided via the system prompt
  // In a full implementation, these would be actual MCP server endpoints
  return {}
}

function resolveEnvironmentSpec(input: {
  playbook: PlaybookRecord
  run: RunRecord
  inputs: Record<string, unknown>
  workingDirectory?: string
}): ResolvedRunEnvironment {
  const defaultRepositories = normalizeStringArray(
    input.playbook.context?.repositories,
    "playbook.context.repositories",
  )
  const providedEnvironment = parseEnvironmentInput(input.inputs.environment)
  const workingDirectory = resolveWorkingDirectory(input.workingDirectory)

  return {
    workingDirectory: workingDirectory ?? process.cwd(),
    spec: {
      kind: "environment",
      id: providedEnvironment?.id ?? `env_${input.run.id}`,
      name: providedEnvironment?.name ?? `${input.playbook.name} Environment`,
      repositories: mergeStringArrays(
        defaultRepositories,
        providedEnvironment?.repositories,
        "environment.repositories",
      ),
      integrations: providedEnvironment?.integrations,
      constraints: mergeObjects(
        providedEnvironment?.constraints,
        workingDirectory ? { workingDirectory } : undefined,
      ),
      metadata: providedEnvironment?.metadata,
    },
  }
}

async function persistResolvedEnvironment(
  runRepository: RunRepository,
  run: RunRecord,
  environment: EnvironmentSpec,
): Promise<RunRecord> {
  return runRepository.update({
    ...run,
    environment: environment.id,
    input: {
      ...run.input,
      environment: structuredClone(environment),
    },
    updatedAt: new Date().toISOString(),
  })
}

function parseEnvironmentInput(value: unknown): Partial<EnvironmentSpec> | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new Error("Invalid environment input: expected an object")
  }

  if (value.kind !== undefined && value.kind !== "environment") {
    throw new Error('Invalid environment.kind: expected "environment"')
  }

  return {
    kind: "environment",
    id: readOptionalNonEmptyString(value.id, "environment.id"),
    name: readOptionalNonEmptyString(value.name, "environment.name"),
    repositories: normalizeStringArray(value.repositories, "environment.repositories"),
    integrations: normalizeStringArray(value.integrations, "environment.integrations"),
    constraints: readOptionalObject(value.constraints, "environment.constraints"),
    metadata: readOptionalObject(value.metadata, "environment.metadata"),
  }
}

function resolveWorkingDirectory(workingDirectory: unknown): string | undefined {
  if (workingDirectory === undefined) {
    return undefined
  }

  return readRequiredNonEmptyString(workingDirectory, "workingDirectory")
}

function readRequiredNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${field}: expected a non-empty string`)
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new Error(`Invalid ${field}: expected a non-empty string`)
  }

  return normalized
}

function readOptionalNonEmptyString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return readRequiredNonEmptyString(value, field)
}

function normalizeStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${field}: expected an array of non-empty strings`)
  }

  return mergeStringArrays(value, undefined, field)
}

function mergeStringArrays(
  left: readonly unknown[] | undefined,
  right: readonly unknown[] | undefined,
  field: string,
): string[] | undefined {
  const merged = [...(left ?? []), ...(right ?? [])].map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`Invalid ${field}: expected an array of non-empty strings`)
    }

    return entry.trim()
  })

  if (merged.length === 0) {
    return undefined
  }

  return Array.from(new Set(merged))
}

function readOptionalObject(
  value: unknown,
  field: string,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid ${field}: expected an object`)
  }

  return structuredClone(value)
}

function mergeObjects(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!left && !right) {
    return undefined
  }

  return {
    ...(left ?? {}),
    ...(right ?? {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
