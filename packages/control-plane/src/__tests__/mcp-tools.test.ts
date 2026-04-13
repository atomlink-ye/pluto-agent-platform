import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ArtifactRecord } from "../repositories.js"
import type { PhaseTransitionResult } from "../services/phase-controller.js"
import {
  createControlPlaneMcpTools,
  declarePhaseToolDefinition,
  registerArtifactToolDefinition,
} from "../mcp-tools/index.js"

const artifactRecord: ArtifactRecord = {
  kind: "artifact",
  id: "art_123",
  run_id: "run_123",
  type: "retro_document",
  title: "Sprint 42 Retro",
  format: "markdown",
  producer: { role_id: "lead", session_id: "sess_123" },
  status: "registered",
  createdAt: "2026-04-14T00:00:00.000Z",
  updatedAt: "2026-04-14T00:00:00.000Z",
}

describe("control-plane MCP tools", () => {
  const phaseController = {
    handlePhaseDeclaration: vi.fn<
      (runId: string, phase: string) => Promise<PhaseTransitionResult>
    >(async () => ({ allowed: true })),
  }
  const artifactService = {
    register: vi.fn(async () => artifactRecord),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("declare_phase calls the phase controller with the run and phase", async () => {
    const tools = createControlPlaneMcpTools({ phaseController, artifactService })

    const result = await tools.handlers.declare_phase({
      runId: "run_123",
      phase: "analyze",
    })

    expect(phaseController.handlePhaseDeclaration).toHaveBeenCalledWith("run_123", "analyze")
    expect(result).toEqual({ allowed: true })
  })

  it("declare_phase returns the phase-controller error for invalid transitions", async () => {
    phaseController.handlePhaseDeclaration.mockResolvedValueOnce({
      allowed: false,
      error: "cannot enter 'review' before completing 'analyze'",
    })

    const tools = createControlPlaneMcpTools({ phaseController, artifactService })
    const result = await tools.handlers.declare_phase({
      runId: "run_123",
      phase: "review",
    })

    expect(result).toEqual({
      allowed: false,
      error: "cannot enter 'review' before completing 'analyze'",
    })
  })

  it("register_artifact calls the artifact service and returns the saved artifact", async () => {
    const tools = createControlPlaneMcpTools({ phaseController, artifactService })

    const result = await tools.handlers.register_artifact({
      runId: "run_123",
      type: "retro_document",
      title: "Sprint 42 Retro",
      format: "markdown",
      producer: { role_id: "lead", session_id: "sess_123" },
    })

    expect(artifactService.register).toHaveBeenCalledWith({
      runId: "run_123",
      type: "retro_document",
      title: "Sprint 42 Retro",
      format: "markdown",
      producer: { role_id: "lead", session_id: "sess_123" },
    })
    expect(result).toEqual(artifactRecord)
  })

  it("register_artifact validates required fields", async () => {
    const tools = createControlPlaneMcpTools({ phaseController, artifactService })

    await expect(
      tools.handlers.register_artifact({
        runId: "run_123",
        type: "retro_document",
      }),
    ).rejects.toThrow("register_artifact requires a non-empty 'title'")
  })

  it("exports standard JSON schemas for both tool inputs", () => {
    expect(declarePhaseToolDefinition.inputSchema).toEqual({
      type: "object",
      description: "Input for declaring the next governed run phase.",
      properties: {
        runId: {
          type: "string",
          description: "Owning run identifier.",
          minLength: 1,
        },
        phase: {
          type: "string",
          description: "Harness phase name the lead agent is entering.",
          minLength: 1,
        },
      },
      required: ["runId", "phase"],
      additionalProperties: false,
    })

    expect(registerArtifactToolDefinition.inputSchema.required).toEqual([
      "runId",
      "type",
      "title",
    ])
    expect(registerArtifactToolDefinition.inputSchema.properties.producer).toEqual({
      type: "object",
      description: "Optional role/session context for the artifact producer.",
      properties: {
        role_id: {
          type: "string",
          description: "Role identifier that produced the artifact.",
          minLength: 1,
        },
        session_id: {
          type: "string",
          description: "Runtime session identifier that produced the artifact.",
          minLength: 1,
        },
      },
      additionalProperties: false,
    })
  })
})
