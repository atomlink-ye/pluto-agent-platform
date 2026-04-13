import type { Artifact } from "@pluto-agent-platform/contracts"

import type { ArtifactRecord } from "../repositories.js"
import type {
  ArtifactRegistrationInput,
  ArtifactService,
} from "../services/artifact-service.js"
import type {
  PhaseController,
  PhaseTransitionResult,
} from "../services/phase-controller.js"
import type {
  HandoffService,
  HandoffRecord,
  HandoffResult,
} from "../services/handoff-service.js"

export interface JsonSchemaString {
  type: "string"
  description?: string
  minLength?: number
}

export interface JsonSchemaObject<
  TProperties extends Record<string, JsonSchema> = Record<string, JsonSchema>,
> {
  type: "object"
  description?: string
  properties: TProperties
  required?: readonly (Extract<keyof TProperties, string>)[]
  additionalProperties?: boolean
}

export type JsonSchema = JsonSchemaString | JsonSchemaObject

export interface ControlPlaneMcpToolDefinition<
  TName extends string = string,
  TSchema extends JsonSchemaObject = JsonSchemaObject,
> {
  name: TName
  description: string
  inputSchema: TSchema
}

export interface ControlPlaneMcpTool<
  TName extends string = string,
  TResult = unknown,
> extends ControlPlaneMcpToolDefinition<TName> {
  handler: (input: unknown) => Promise<TResult>
}

export interface DeclarePhaseInput {
  runId: string
  phase: string
}

export type RegisterArtifactInput = ArtifactRegistrationInput

type ArtifactProducer = Artifact["producer"]

export const declarePhaseToolDefinition = {
  name: "declare_phase",
  description:
    "Declare that the lead agent is entering a harness phase so the control plane can validate ordering.",
  inputSchema: {
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
  },
} satisfies ControlPlaneMcpToolDefinition<"declare_phase">

export const registerArtifactToolDefinition = {
  name: "register_artifact",
  description:
    "Register a governed run artifact so durable metadata and lineage are recorded in the control plane.",
  inputSchema: {
    type: "object",
    description: "Input for registering an artifact produced during a governed run.",
    properties: {
      runId: {
        type: "string",
        description: "Owning run identifier.",
        minLength: 1,
      },
      type: {
        type: "string",
        description: "Stable artifact type identifier.",
        minLength: 1,
      },
      title: {
        type: "string",
        description: "Human-readable artifact title.",
        minLength: 1,
      },
      format: {
        type: "string",
        description: "Optional artifact format such as markdown or json.",
        minLength: 1,
      },
      producer: {
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
      },
    },
    required: ["runId", "type", "title"],
    additionalProperties: false,
  },
} satisfies ControlPlaneMcpToolDefinition<"register_artifact">

export interface CreateHandoffInput {
  runId: string
  fromRole: string
  toRole: string
  summary: string
  context?: string
}

export interface RejectHandoffInput {
  handoffId: string
  reason: string
}

export const createHandoffToolDefinition = {
  name: "create_handoff",
  description:
    "Delegates work to another team role. A worker session is spawned when the handoff is accepted.",
  inputSchema: {
    type: "object",
    description: "Input for creating a handoff delegation to another team role.",
    properties: {
      runId: {
        type: "string",
        description: "Owning run identifier.",
        minLength: 1,
      },
      fromRole: {
        type: "string",
        description: "Role ID of the delegating agent.",
        minLength: 1,
      },
      toRole: {
        type: "string",
        description: "Role ID of the target worker agent.",
        minLength: 1,
      },
      summary: {
        type: "string",
        description: "Summary of the work to be delegated.",
        minLength: 1,
      },
      context: {
        type: "string",
        description: "Optional additional context for the worker.",
        minLength: 1,
      },
    },
    required: ["runId", "fromRole", "toRole", "summary"],
    additionalProperties: false,
  },
} satisfies ControlPlaneMcpToolDefinition<"create_handoff">

export const rejectHandoffToolDefinition = {
  name: "reject_handoff",
  description:
    "Rejects a pending handoff request so that no worker session is created.",
  inputSchema: {
    type: "object",
    description: "Input for rejecting a pending handoff.",
    properties: {
      handoffId: {
        type: "string",
        description: "Handoff identifier to reject.",
        minLength: 1,
      },
      reason: {
        type: "string",
        description: "Reason for rejecting the handoff.",
        minLength: 1,
      },
    },
    required: ["handoffId", "reason"],
    additionalProperties: false,
  },
} satisfies ControlPlaneMcpToolDefinition<"reject_handoff">

export const controlPlaneMcpToolDefinitions = [
  declarePhaseToolDefinition,
  registerArtifactToolDefinition,
  createHandoffToolDefinition,
  rejectHandoffToolDefinition,
] as const

export interface CreateControlPlaneMcpToolsDeps {
  phaseController: Pick<PhaseController, "handlePhaseDeclaration">
  artifactService: Pick<ArtifactService, "register">
  handoffService?: Pick<HandoffService, "createHandoff" | "rejectHandoff">
}

export interface ControlPlaneMcpTools {
  definitions: typeof controlPlaneMcpToolDefinitions
  handlers: {
    declare_phase: (input: unknown) => Promise<PhaseTransitionResult>
    register_artifact: (input: unknown) => Promise<ArtifactRecord>
    create_handoff: (input: unknown) => Promise<HandoffResult>
    reject_handoff: (input: unknown) => Promise<HandoffRecord>
  }
  tools: readonly [
    ControlPlaneMcpTool<"declare_phase", PhaseTransitionResult>,
    ControlPlaneMcpTool<"register_artifact", ArtifactRecord>,
    ControlPlaneMcpTool<"create_handoff", HandoffResult>,
    ControlPlaneMcpTool<"reject_handoff", HandoffRecord>,
  ]
}

export async function handleDeclarePhase(
  input: unknown,
  deps: CreateControlPlaneMcpToolsDeps,
): Promise<PhaseTransitionResult> {
  const parsed = parseDeclarePhaseInput(input)
  return deps.phaseController.handlePhaseDeclaration(parsed.runId, parsed.phase)
}

export async function handleRegisterArtifact(
  input: unknown,
  deps: CreateControlPlaneMcpToolsDeps,
): Promise<ArtifactRecord> {
  const parsed = parseRegisterArtifactInput(input)
  return deps.artifactService.register(parsed)
}

export async function handleCreateHandoff(
  input: unknown,
  deps: CreateControlPlaneMcpToolsDeps,
): Promise<HandoffResult> {
  if (!deps.handoffService) {
    throw new Error("create_handoff requires handoffService (team runs only)")
  }
  const parsed = parseCreateHandoffInput(input)
  return deps.handoffService.createHandoff(parsed)
}

export async function handleRejectHandoff(
  input: unknown,
  deps: CreateControlPlaneMcpToolsDeps,
): Promise<HandoffRecord> {
  if (!deps.handoffService) {
    throw new Error("reject_handoff requires handoffService (team runs only)")
  }
  const parsed = parseRejectHandoffInput(input)
  return deps.handoffService.rejectHandoff(parsed.handoffId, parsed.reason)
}

export function createControlPlaneMcpTools(
  deps: CreateControlPlaneMcpToolsDeps,
): ControlPlaneMcpTools {
  const handlers = {
    declare_phase: (input: unknown) => handleDeclarePhase(input, deps),
    register_artifact: (input: unknown) => handleRegisterArtifact(input, deps),
    create_handoff: (input: unknown) => handleCreateHandoff(input, deps),
    reject_handoff: (input: unknown) => handleRejectHandoff(input, deps),
  }

  return {
    definitions: controlPlaneMcpToolDefinitions,
    handlers,
    tools: [
      {
        ...declarePhaseToolDefinition,
        handler: handlers.declare_phase,
      },
      {
        ...registerArtifactToolDefinition,
        handler: handlers.register_artifact,
      },
      {
        ...createHandoffToolDefinition,
        handler: handlers.create_handoff,
      },
      {
        ...rejectHandoffToolDefinition,
        handler: handlers.reject_handoff,
      },
    ],
  }
}

function parseDeclarePhaseInput(input: unknown): DeclarePhaseInput {
  const value = expectObject(input, declarePhaseToolDefinition.name)
  assertAllowedKeys(value, ["runId", "phase"], declarePhaseToolDefinition.name)

  return {
    runId: requireNonEmptyString(value, "runId", declarePhaseToolDefinition.name),
    phase: requireNonEmptyString(value, "phase", declarePhaseToolDefinition.name),
  }
}

function parseRegisterArtifactInput(input: unknown): RegisterArtifactInput {
  const value = expectObject(input, registerArtifactToolDefinition.name)
  assertAllowedKeys(
    value,
    ["runId", "type", "title", "format", "producer"],
    registerArtifactToolDefinition.name,
  )

  const format = optionalNonEmptyString(
    value,
    "format",
    registerArtifactToolDefinition.name,
  )
  const producer = parseArtifactProducer(value.producer)

  return {
    runId: requireNonEmptyString(value, "runId", registerArtifactToolDefinition.name),
    type: requireNonEmptyString(value, "type", registerArtifactToolDefinition.name),
    title: requireNonEmptyString(value, "title", registerArtifactToolDefinition.name),
    ...(format ? { format } : {}),
    ...(producer ? { producer } : {}),
  }
}

function parseArtifactProducer(input: unknown): ArtifactProducer | undefined {
  if (input === undefined) {
    return undefined
  }

  const value = expectObject(input, `${registerArtifactToolDefinition.name}.producer`)
  assertAllowedKeys(
    value,
    ["role_id", "session_id"],
    `${registerArtifactToolDefinition.name}.producer`,
  )

  const role_id = optionalNonEmptyString(
    value,
    "role_id",
    `${registerArtifactToolDefinition.name}.producer`,
  )
  const session_id = optionalNonEmptyString(
    value,
    "session_id",
    `${registerArtifactToolDefinition.name}.producer`,
  )

  if (!role_id && !session_id) {
    return undefined
  }

  return {
    ...(role_id ? { role_id } : {}),
    ...(session_id ? { session_id } : {}),
  }
}

function parseCreateHandoffInput(input: unknown): CreateHandoffInput {
  const value = expectObject(input, createHandoffToolDefinition.name)
  assertAllowedKeys(
    value,
    ["runId", "fromRole", "toRole", "summary", "context"],
    createHandoffToolDefinition.name,
  )

  const context = optionalNonEmptyString(
    value,
    "context",
    createHandoffToolDefinition.name,
  )

  return {
    runId: requireNonEmptyString(value, "runId", createHandoffToolDefinition.name),
    fromRole: requireNonEmptyString(value, "fromRole", createHandoffToolDefinition.name),
    toRole: requireNonEmptyString(value, "toRole", createHandoffToolDefinition.name),
    summary: requireNonEmptyString(value, "summary", createHandoffToolDefinition.name),
    ...(context ? { context } : {}),
  }
}

function parseRejectHandoffInput(input: unknown): RejectHandoffInput {
  const value = expectObject(input, rejectHandoffToolDefinition.name)
  assertAllowedKeys(
    value,
    ["handoffId", "reason"],
    rejectHandoffToolDefinition.name,
  )

  return {
    handoffId: requireNonEmptyString(value, "handoffId", rejectHandoffToolDefinition.name),
    reason: requireNonEmptyString(value, "reason", rejectHandoffToolDefinition.name),
  }
}

function expectObject(input: unknown, toolName: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${toolName} input must be an object`)
  }

  return input as Record<string, unknown>
}

function assertAllowedKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
  toolName: string,
): void {
  const unexpectedKeys = Object.keys(input).filter((key) => !allowedKeys.includes(key))

  if (unexpectedKeys.length > 0) {
    throw new Error(`${toolName} received unexpected fields: ${unexpectedKeys.join(", ")}`)
  }
}

function requireNonEmptyString(
  input: Record<string, unknown>,
  field: string,
  toolName: string,
): string {
  const value = input[field]

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${toolName} requires a non-empty '${field}'`)
  }

  return value.trim()
}

function optionalNonEmptyString(
  input: Record<string, unknown>,
  field: string,
  toolName: string,
): string | undefined {
  const value = input[field]

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${toolName} field '${field}' must be a non-empty string`)
  }

  return value.trim()
}
