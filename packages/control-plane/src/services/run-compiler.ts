/**
 * Run Compiler — Plan 003 Feature 3
 *
 * Compiles a run from playbook + harness + inputs into a live Paseo agent session.
 * Follows the 11-step compilation sequence from the plan.
 */
import { randomUUID } from "node:crypto"
import type {
  RunPlan,
  PolicySnapshot,
  RunSession,
} from "@pluto-agent-platform/contracts"
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
import type {
  AgentManager,
  AgentSessionConfig,
} from "../paseo/types.js"

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

export class RunCompiler {
  constructor(private readonly deps: RunCompilerDeps) {}

  async compile(input: CompileRunInput): Promise<RunRecord> {
    let run: RunRecord | null = null
    let agentId: string | null = null

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

      // Step 3: Policy snapshot already created by runService.create()
      // Step 4: Run plan already created by runService.create()

      // Step 5: Transition to "initializing"
      run = await this.deps.runService.transition(run.id, "initializing")

      // Step 6: Construct agent system prompt
      const systemPrompt = buildSystemPrompt(playbook, harness)

      // Step 7: Create Paseo agent
      const agentConfig: AgentSessionConfig = {
        provider: input.provider ?? "claude",
        cwd: input.workingDirectory ?? process.cwd(),
        systemPrompt,
        title: `Run: ${playbook.name}`,
        mcpServers: buildMcpServers(),
      }

      const agent = await this.deps.agentManager.createAgent(agentConfig)
      agentId = agent.id

      // Step 8: Register agent in Runtime Adapter tracking
      this.deps.runtimeAdapter.trackRun(run.id, agent.id)

      // Step 9: Create RunSession linking run to Paseo agent
      const sessionRecord: RunSessionRecord = {
        kind: "run_session",
        id: `sess_${randomUUID()}`,
        run_id: run.id,
        session_id: agent.id,
        provider: agentConfig.provider,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      await this.deps.runSessionRepository.save(sessionRecord)

      // Step 10: Start the agent with initial prompt
      const initialPrompt = buildInitialPrompt(playbook, input.inputs)
      // Fire and forget — the runtime adapter will track events
      this.deps.agentManager
        .runAgent(agent.id, initialPrompt)
        .catch(() => {
          // Errors will be caught by the runtime adapter via events
        })

      // Step 11: Transition to "running"
      run = await this.deps.runService.transition(run.id, "running")

      return run
    } catch (error) {
      // Rollback: transition to failed
      if (run) {
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
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(playbook: PlaybookRecord, harness: HarnessRecord): string {
  const sections: string[] = []

  sections.push(`# Task: ${playbook.name}`)
  sections.push(`## Goal\n${playbook.goal}`)
  sections.push(`## Instructions\n${playbook.instructions}`)

  if (playbook.context?.repositories?.length) {
    sections.push(`## Repositories\n${playbook.context.repositories.join("\n")}`)
  }

  // Harness governance context
  sections.push(`## Execution Governance`)
  sections.push(`### Phases\nYou must progress through these phases in order: ${harness.phases.join(" → ")}`)
  sections.push(`To transition to the next phase, call the \`declare_phase\` MCP tool.`)

  if (harness.approvals) {
    const approvalRules = Object.entries(harness.approvals)
      .filter(([, v]) => v === "required")
      .map(([k]) => k)
    if (approvalRules.length > 0) {
      sections.push(`### Approval Rules\nThe following action classes require approval: ${approvalRules.join(", ")}`)
    }
  }

  if (playbook.artifacts?.length) {
    sections.push(`### Required Artifacts`)
    for (const art of playbook.artifacts) {
      sections.push(`- Type: ${art.type}${art.format ? ` (format: ${art.format})` : ""}${art.description ? ` — ${art.description}` : ""}`)
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
