import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  closeLiveE2EDockerTestContext,
  getLiveE2EDockerTestContext,
  resetLiveE2EDockerDatabase,
  type LiveE2EDockerTestContext,
} from "./live-setup.js"

const describeLiveAgent = process.env.LIVE_AGENT_E2E === "1" ? describe : describe.skip

let context: LiveE2EDockerTestContext
let stopRuntimeAdapter: (() => void) | null = null

describeLiveAgent("Docker E2E: live OpenCode agent runtime", () => {
  beforeAll(async () => {
    context = await getLiveE2EDockerTestContext()
  })

  beforeEach(async () => {
    await resetLiveE2EDockerDatabase()
    stopRuntimeAdapter = context.runtimeAdapter.start()
  })

  afterEach(() => {
    stopRuntimeAdapter?.()
    stopRuntimeAdapter = null
  })

  afterAll(async () => {
    await closeLiveE2EDockerTestContext()
  })

  it("compiles a run and persists an OpenCode-backed run session", async () => {
    stopRuntimeAdapter?.()
    stopRuntimeAdapter = null

    const playbook = await context.playbookService.create({
      name: "Live Compile Session Playbook",
      description: "Verifies compile-time binding to a local OpenCode runtime",
      goal: "Create a governed run backed by a real OpenCode session",
      instructions: "Acknowledge the task briefly.",
      artifacts: [],
    })

    const harness = await context.harnessService.create({
      name: "Live Compile Session Harness",
      description: "Single-phase harness for compile/session verification",
      phases: ["work"],
    })

    await context.harnessService.attachToPlaybook(harness.id, playbook.id)

    const run = await context.compiler.compile({
      playbookId: playbook.id,
      harnessId: harness.id,
      inputs: {},
      provider: "opencode",
      workingDirectory: process.cwd(),
    })

    const [runSession] = await waitFor(async () => {
      const sessions = await context.runSessionRepo.listByRunId(run.id)
      return sessions.length > 0 ? sessions : null
    })

    const testSession = context.agentClient.getSessionByAgentId(runSession.session_id)

    expect(run.status).toBe("running")
    expect(runSession.provider).toBe("opencode")
    expect(runSession.persistence_handle).toBeTruthy()
    expect(testSession).toBeDefined()
    expect(testSession?.id).toBe(runSession.persistence_handle)

    await context.agentManager.killAgent(runSession.session_id)
  }, 30_000)

  it("uses the co-deployed OpenCode runtime with the free MiniMax build default", async () => {
    const agent = await context.agentManager.createAgent({
      provider: "opencode",
      cwd: process.cwd(),
      title: "Live OpenCode MiniMax build smoke test",
    })

    const result = await context.agentManager.runAgent(agent.id, "Reply with exactly: hi")

    const deliveredPrompt = await waitFor(() => {
      return context.agentClient.deliveredPrompts.find((entry) => entry.agentId === agent.id) ?? null
    })

    expect(result.finalText.trim().toLowerCase()).toBe("hi")
    expect(deliveredPrompt.opencodeSessionId).toBeTruthy()
    expect(deliveredPrompt.prompt).toContain("Reply with exactly: hi")
    expect(
      normalizeRuntimeValue(deliveredPrompt.runtimeMetadata.mode),
      `Expected OpenCode runtime to report build mode for initial prompt; received ${formatRuntimeMetadata(deliveredPrompt.runtimeMetadata)}`,
    ).toBe("build")

    const normalizedProvider = normalizeRuntimeValue(deliveredPrompt.runtimeMetadata.providerId)
    const normalizedModel = normalizeRuntimeValue(deliveredPrompt.runtimeMetadata.modelId)

    expect(
      normalizedProvider,
      `Expected OpenCode runtime to report the OpenCode provider for initial prompt; received ${formatRuntimeMetadata(deliveredPrompt.runtimeMetadata)}`,
    ).toBe("opencode")
    expect(
      normalizedModel,
      `Expected OpenCode runtime to report a free MiniMax/default OpenCode model for initial prompt; received ${formatRuntimeMetadata(deliveredPrompt.runtimeMetadata)}`,
    ).toContain("minimax")
    expect(
      normalizedModel,
      `Expected OpenCode runtime to report a free MiniMax/default OpenCode model for initial prompt; received ${formatRuntimeMetadata(deliveredPrompt.runtimeMetadata)}`,
    ).toContain("free")
    expect(normalizedModel).not.toContain("gpt-5.4")
  }, 60_000)
})

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

function formatRuntimeMetadata(metadata: {
  providerId: string | null
  modelId: string | null
  mode: string | null
  agent: string | null
}): string {
  return JSON.stringify(metadata)
}

function normalizeRuntimeValue(value: string | null): string {
  return value?.trim().toLowerCase() ?? ""
}
