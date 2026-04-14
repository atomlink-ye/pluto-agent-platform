import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  closeLiveE2EDockerTestContext,
  getLiveE2EDockerTestContext,
  resetLiveE2EDockerDatabase,
  type LiveE2EDockerTestContext,
} from "./live-setup.js"

const execFileAsync = promisify(execFile)
const describeLiveAgent = process.env.LIVE_AGENT_E2E === "1" ? describe : describe.skip
const itNativeTeam = process.env.NATIVE_TEAM_E2E === "1" ? it : it.skip

let context: LiveE2EDockerTestContext
let stopRuntimeAdapter: (() => void) | null = null
let cloneRoot: string | null = null

describeLiveAgent("Docker E2E: native live team orchestration", () => {
  beforeAll(async () => {
    context = await getLiveE2EDockerTestContext()
  }, 30_000)

  beforeEach(async () => {
    await resetLiveE2EDockerDatabase()
    stopRuntimeAdapter = context.runtimeAdapter.start()
    cloneRoot = await cloneOpenCodeRepository()
  }, 90_000)

  afterEach(async () => {
    stopRuntimeAdapter?.()
    stopRuntimeAdapter = null

    if (cloneRoot) {
      await rm(cloneRoot, { recursive: true, force: true })
      cloneRoot = null
    }
  }, 30_000)

  afterAll(async () => {
    await closeLiveE2EDockerTestContext()
  }, 60_000)

  itNativeTeam("starts a team run that autonomously orchestrates planner/generator/evaluator workers", async () => {
    const teamLead = await context.roleService.create({
      name: "Team Lead",
      description: "Leads the run and delegates phases to specialists.",
      system_prompt: [
        "You are the team lead.",
        "Do not inspect or modify the repository yourself unless strictly necessary.",
        "Use the control-plane tools immediately to orchestrate the work.",
        "First enter the active harness phase, then delegate planner work.",
        "After planner completion, delegate generator work based on the planner result.",
        "After generator completion, delegate evaluator work and ensure a durable run summary is registered.",
      ].join(" "),
    })
    const planner = await context.roleService.create({
      name: "Planner",
      description: "Designs a narrow implementation approach.",
    })
    const generator = await context.roleService.create({
      name: "Generator",
      description: "Applies the smallest safe local-only change when needed.",
    })
    const evaluator = await context.roleService.create({
      name: "Evaluator",
      description: "Checks the result and records a durable summary.",
    })

    const team = await context.teamService.create({
      name: "Native Live Team",
      description: "Lead-driven planner/generator/evaluator execution team.",
      lead_role: teamLead.id,
      roles: [teamLead.id, planner.id, generator.id, evaluator.id],
      coordination: { mode: "supervisor-led" },
    })

    const playbook = await context.playbookService.create({
      name: "Native live team orchestration",
      description: "Verify a live team lead can orchestrate specialist workers over the platform MCP tools.",
      goal: "Use the control-plane to drive planner, generator, and evaluator work in a disposable opencode clone.",
      instructions: [
        "Use the harness phases natively.",
        "The team lead should immediately use control-plane tools rather than doing repository work directly.",
        "Planner: inspect anomalyco/opencode and identify one small, safe issue worth improving.",
        "Generator: implement only that one minimal local-only improvement in the disposable clone.",
        "Evaluator: review the generator result and register a durable markdown run summary artifact.",
        "Do not push or publish anything.",
      ].join(" "),
      artifacts: [{ type: "run_summary", format: "markdown" }],
      context: {
        repositories: [cloneRoot!],
      },
    })

    const harness = await context.harnessService.create({
      name: "Native live team harness",
      description: "Three ordered specialist phases for native team orchestration.",
      phases: ["planner", "generator", "evaluator"],
    })

    await context.harnessService.attachToPlaybook(harness.id, playbook.id)

    const run = await context.compiler.compile({
      playbookId: playbook.id,
      harnessId: harness.id,
      inputs: {
        environment: {
          kind: "environment",
          id: "env_native_live_team",
          name: "Native live team environment",
          repositories: [cloneRoot!],
          constraints: {
            workingDirectory: cloneRoot!,
          },
        },
      },
      provider: "opencode",
      workingDirectory: cloneRoot!,
      teamId: team.id,
    })

    const events = await waitFor(async () => {
      const currentEvents = await context.runEventRepo.listByRunId(run.id)
      const handoffEvents = currentEvents.filter((event) => event.eventType.startsWith("handoff."))
      const phases = currentEvents.filter((event) => event.eventType === "phase.entered")
      const artifacts = await context.artifactRepo.listByRunId(run.id)
      const sessions = await context.runSessionRepo.listByRunId(run.id)

      if (handoffEvents.length >= 6 && phases.length >= 2 && artifacts.length >= 1 && sessions.length >= 4) {
        return currentEvents
      }

      return null
    }, { timeoutMs: 300_000, intervalMs: 750 })

    const sessions = await context.runSessionRepo.listByRunId(run.id)
    const artifacts = await context.artifactRepo.listByRunId(run.id)
    const handoffEvents = events.filter((event) => event.eventType.startsWith("handoff."))
    const phaseEvents = events.filter((event) => event.eventType === "phase.entered")
    const agents = context.agentManager.listAgents().filter((agent) =>
      sessions.some((session) => session.session_id === agent.id),
    )

    expect(run.status).toBe("running")
    expect(handoffEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "handoff.created",
        "handoff.accepted",
      ]),
    )
    expect(phaseEvents.map((event) => event.payload)).toEqual(
      expect.arrayContaining([
        { phase: "generator" },
        { phase: "evaluator" },
      ]),
    )
    const persistedRun = await context.runRepo.getById(run.id)
    expect(persistedRun?.current_phase).toBe("evaluator")
    expect(sessions).toHaveLength(4)
    expect(sessions.every((session) => session.provider === "opencode")).toBe(true)
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "run_summary", format: "markdown" }),
      ]),
    )
    expect(agents).toHaveLength(4)
    expect(agents.every((agent) => agent.config.cwd === cloneRoot)).toBe(true)
    expect(context.agentClient.deliveredPrompts.some((entry) => entry.agentId === sessions[0]?.session_id)).toBe(true)
  }, 360_000)
})

async function cloneOpenCodeRepository(): Promise<string> {
  const sharedRoot = join(process.cwd(), ".tmp")
  await mkdir(sharedRoot, { recursive: true })

  const root = await mkdtemp(join(sharedRoot, "pluto-native-live-team-"))
  const target = join(root, "opencode")

  if (await hasExecutable("git")) {
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "https://github.com/anomalyco/opencode.git", target],
      { timeout: 180_000 },
    )
    return target
  }

  await mkdir(target, { recursive: true })
  const archivePath = join(root, "opencode.tar.gz")
  const response = await fetch("https://api.github.com/repos/anomalyco/opencode/tarball", {
    headers: {
      "user-agent": "pluto-native-live-team-test",
      accept: "application/vnd.github+json",
    },
    redirect: "follow",
  })
  if (!response.ok) {
    throw new Error(`Failed to download anomalyco/opencode archive: ${response.status} ${response.statusText}`)
  }

  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()))
  await execFileAsync(
    "tar",
    ["-xzf", archivePath, "--strip-components=1", "-C", target],
    { timeout: 180_000 },
  )

  return target
}

async function hasExecutable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], { timeout: 15_000 })
    return true
  } catch {
    return false
  }
}

async function waitFor<T>(
  producer: () => Promise<T | null> | T | null,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 30_000
  const intervalMs = options?.intervalMs ?? 100
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const value = await producer()
    if (value != null) {
      return value
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Timed out after ${timeoutMs}ms`)
}
