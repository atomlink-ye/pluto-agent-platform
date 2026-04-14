import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type { RunEventEnvelope } from "@pluto-agent-platform/contracts"

import {
  closeLiveE2EDockerTestContext,
  getLiveE2EDockerTestContext,
  resetLiveE2EDockerDatabase,
  type LiveE2EDockerTestContext,
} from "./live-setup.js"

const describeLiveAgent = process.env.LIVE_AGENT_E2E === "1" ? describe : describe.skip

let context: LiveE2EDockerTestContext

describeLiveAgent("Docker E2E: live OpenCode agent runtime", () => {
  beforeAll(() => {
    context = getLiveE2EDockerTestContext()
  })

  beforeEach(async () => {
    await resetLiveE2EDockerDatabase()
    context.runtimeAdapter.start()
  })

  afterAll(async () => {
    await closeLiveE2EDockerTestContext()
  })

  it("compiles an opencode run, delivers the prompt, and projects runtime events", async () => {
    const playbook = await context.playbookService.create({
      name: "Live Agent E2E Playbook",
      description: "Exercises a real OpenCode runtime from the control plane",
      goal: "Verify prompt delivery and runtime event projection against OpenCode",
      instructions: "Follow the harness and use control-plane tools when directed.",
      artifacts: [{ type: "run_report", format: "json" }],
    })

    const harness = await context.harnessService.create({
      name: "Live Agent E2E Harness",
      description: "Minimal harness for live runtime verification",
      phases: ["work", "review"],
      approvals: { destructive_write: "required" },
    })

    await context.harnessService.attachToPlaybook(harness.id, playbook.id)

    const run = await context.compiler.compile({
      playbookId: playbook.id,
      harnessId: harness.id,
      inputs: {
        topic: "live-agent-e2e",
      },
      provider: "opencode",
      workingDirectory: process.cwd(),
    })

    const [runSession] = await waitFor(async () => {
      const sessions = await context.runSessionRepo.listByRunId(run.id)
      return sessions.length > 0 ? sessions : null
    })

    const deliveredPrompt = await waitFor(() => {
      return (
        context.agentClient.deliveredPrompts.find((entry) => entry.agentId === runSession.session_id) ??
        null
      )
    })

    expect(run.status).toBe("running")
    expect(deliveredPrompt.opencodeSessionId).toBeTruthy()
    expect(deliveredPrompt.prompt).toContain(`Begin executing the task \"${playbook.name}\".`)
    expect(deliveredPrompt.prompt).toContain("topic")

    const testSession = context.agentClient.getSessionByAgentId(runSession.session_id)
    expect(testSession).toBeDefined()

    testSession?.emitTimeline(
      {
        type: "tool_call",
        callId: "tool_call_review",
        name: "declare_phase",
        status: "completed",
        error: null,
        detail: {
          type: "plain_text",
        },
        input: { phase: "review" },
      },
      "turn_live_phase",
    )

    const phaseEvent = await waitForRunEvent(run.id, (event) => event.eventType === "phase.entered")
    expect(phaseEvent.payload).toEqual({ phase: "review" })

    const phaseResult = await context.phaseController.handlePhaseDeclaration(run.id, "review")
    expect(phaseResult.allowed).toBe(true)

    const [approval] = await waitFor(async () => {
      const approvals = await context.approvalRepo.listByRunId(run.id)
      return approvals.length > 0 ? approvals : null
    })

    expect(approval.status).toBe("pending")

    await context.phaseController.handleApprovalResolution(run.id, approval.id, "approved")
    await context.approvalService.resolve(
      approval.id,
      "approved",
      "operator_live",
      "Approved in live OpenCode E2E",
    )

    const approvalPrompt = await waitFor(() => {
      return (
        context.agentClient.deliveredPrompts.find(
          (entry) =>
            entry.agentId === runSession.session_id &&
            entry.prompt.includes("Approval granted for review phase. Proceed with execution."),
        ) ?? null
      )
    })

    expect(approvalPrompt.prompt).toContain("Proceed with execution")
  })
})

async function waitFor<T>(
  producer: () => Promise<T | null> | T | null,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 10_000
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

async function waitForRunEvent(
  runId: string,
  predicate: (event: RunEventEnvelope) => boolean,
): Promise<RunEventEnvelope> {
  return waitFor(async () => {
    const events = await context.runEventRepo.listByRunId(runId)
    return events.find(predicate) ?? null
  })
}
