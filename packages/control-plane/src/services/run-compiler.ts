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
} from "../repositories.js"
import type { RunService } from "./run-service.js"
import type { AgentManager, AgentSessionConfig } from "../paseo/types.js"

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
  runService: RunService
  agentManager: AgentManager
  runtimeAdapter: RuntimeAdapterRegistry
}

export interface CompileRunInput {
  playbookId: string
  harnessId: string
  inputs: Record<string, unknown>
  provider?: string
  workingDirectory?: string
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

      // Step 2: Create run with status "queued"
      run = await this.deps.runService.create(
        input.playbookId,
        input.harnessId,
        input.inputs,
      )

      const resolvedEnvironment = resolveEnvironmentSpec({
        playbook,
        run,
        inputs: input.inputs,
        workingDirectory: input.workingDirectory,
      })
      run = await persistResolvedEnvironment(this.deps.runRepository, run, resolvedEnvironment.spec)

      // Step 3: Policy snapshot already created by runService.create()
      // Step 4: Run plan already created by runService.create()

      // Step 5: Transition to "initializing"
      run = await this.deps.runService.transition(run.id, "initializing")

      // Step 6: Construct agent system prompt
      const systemPrompt = buildSystemPrompt(playbook, harness, resolvedEnvironment.spec)

      // Step 7: Create Paseo agent
      const agentConfig: AgentSessionConfig = {
        provider: input.provider ?? "claude",
        cwd: resolvedEnvironment.workingDirectory,
        systemPrompt,
        title: `Run: ${playbook.name}`,
        mcpServers: buildMcpServers(),
      }

      const agent = await this.deps.agentManager.createAgent(agentConfig)
      const persistenceHandle = this.deps.agentManager.getAgent?.(agent.id)?.persistence?.sessionId
        ?? agent.persistence?.sessionId

      try {
        // Step 8: Register agent in Runtime Adapter tracking
        this.deps.runtimeAdapter.trackRun(run.id, agent.id)

        // Step 9: Create RunSession linking run to Paseo agent
        const sessionRecord: RunSessionRecord = {
          kind: "run_session",
          id: `sess_${randomUUID()}`,
          run_id: run.id,
          session_id: agent.id,
          persistence_handle: persistenceHandle,
          provider: agentConfig.provider,
          status: "active",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        await this.deps.runSessionRepository.save(sessionRecord)

        // Step 10: Start the agent with initial prompt
        const initialPrompt = buildInitialPrompt(playbook, run.input)
        // Fire and forget — the runtime adapter will track events
        this.deps.agentManager
          .runAgent(agent.id, initialPrompt)
          .catch(() => {
            // Errors will be caught by the runtime adapter via events
          })

        // Step 11: Transition to "running"
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
  environment: EnvironmentSpec,
): string {
  const sections: string[] = []

  sections.push(`# Task: ${playbook.name}`)
  sections.push(`## Goal\n${playbook.goal}`)
  sections.push(`## Instructions\n${playbook.instructions}`)

  if (environment.repositories?.length) {
    sections.push(`## Repositories\n${environment.repositories.join("\n")}`)
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
  sections.push(`### declare_phase\nDeclares transition to the next execution phase.\nParameters: { "phase": "<phase_name>" }`)
  sections.push(`### register_artifact\nRegisters a deliverable produced during execution.\nParameters: { "type": "<artifact_type>", "title": "<title>", "format": "<format>" }`)

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
