import { randomUUID } from "node:crypto"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import {
  createControlPlaneMcpTools,
  controlPlaneMcpToolDefinitions,
  type CreateControlPlaneMcpToolsDeps,
  type JsonSchema,
  type JsonSchemaObject,
} from "@pluto-agent-platform/control-plane"
import type express from "express"
import { z } from "zod"

export interface MountedControlPlaneMcpEndpoint {
  close(): Promise<void>
}

type SupportedToolName = (typeof controlPlaneMcpToolDefinitions)[number]["name"]

export function mountControlPlaneMcpEndpoint(
  app: express.Express,
  deps: CreateControlPlaneMcpToolsDeps,
): MountedControlPlaneMcpEndpoint {
  const transports = new Map<string, StreamableHTTPServerTransport>()

  app.all("/mcp", async (req, res) => {
    try {
      const sessionId = req.header("mcp-session-id")
      let transport = sessionId ? transports.get(sessionId) : undefined

      if (!transport) {
        if (sessionId) {
          res.status(404).json(buildJsonRpcError("Session not found"))
          return
        }

        if (req.method !== "POST" || !isInitializeRequest(req.body)) {
          res.status(400).json(buildJsonRpcError("No valid MCP session ID provided"))
          return
        }

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            transports.set(initializedSessionId, transport!)
          },
        })

        transport.onclose = () => {
          const initializedSessionId = transport?.sessionId
          if (initializedSessionId) {
            transports.delete(initializedSessionId)
          }
        }

        const server = createControlPlaneMcpServer(deps)
        await server.connect(transport)
      }

      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json(
          buildJsonRpcError(
            error instanceof Error ? error.message : "Internal MCP server error",
          ),
        )
      }
    }
  })

  return {
    async close() {
      await Promise.all(
        Array.from(transports.values()).map((transport) => transport.close().catch(() => undefined)),
      )
      transports.clear()
    },
  }
}

function createControlPlaneMcpServer(deps: CreateControlPlaneMcpToolsDeps): McpServer {
  const server = new McpServer({
    name: "pluto-control-plane",
    version: "0.1.0",
  })
  const tools = createControlPlaneMcpTools(deps)

  for (const tool of tools.tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: toZodObjectSchema(tool.inputSchema),
      },
      async (input) => buildToolResult(await invokeToolHandler(tool.name, input, tools.handlers)),
    )
  }

  return server
}

async function invokeToolHandler(
  toolName: SupportedToolName,
  input: unknown,
  handlers: ReturnType<typeof createControlPlaneMcpTools>["handlers"],
): Promise<unknown> {
  switch (toolName) {
    case "declare_phase":
      return handlers.declare_phase(input)
    case "register_artifact":
      return handlers.register_artifact(input)
    case "create_handoff":
      return handlers.create_handoff(input)
    case "reject_handoff":
      return handlers.reject_handoff(input)
  }
}

function buildToolResult(result: unknown) {
  const structuredContent = normalizeStructuredContent(result)

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
    structuredContent,
  }
}

function normalizeStructuredContent(result: unknown): Record<string, unknown> {
  const normalized = JSON.parse(JSON.stringify(result ?? null)) as unknown

  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    return normalized as Record<string, unknown>
  }

  return { result: normalized }
}

function buildJsonRpcError(message: string) {
  return {
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message,
    },
    id: null,
  }
}

function toZodObjectSchema(schema: JsonSchemaObject): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape = Object.fromEntries(
    Object.entries(schema.properties).map(([name, propertySchema]) => [name, toZodSchema(propertySchema)]),
  )
  const requiredFields = new Set(schema.required ?? [])

  for (const [name, value] of Object.entries(shape)) {
    if (!requiredFields.has(name)) {
      shape[name] = value.optional()
    }
  }

  let objectSchema = z.object(shape)
  if (schema.additionalProperties === false) {
    objectSchema = objectSchema.strict()
  }

  return objectSchema
}

function toZodSchema(schema: JsonSchema): z.ZodTypeAny {
  switch (schema.type) {
    case "string": {
      let stringSchema = z.string()
      if (schema.minLength != null) {
        stringSchema = stringSchema.min(schema.minLength)
      }
      return stringSchema
    }
    case "object":
      return toZodObjectSchema(schema)
  }
}
