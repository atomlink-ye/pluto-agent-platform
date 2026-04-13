import type { Playbook } from "@pluto-agent-platform/contracts"

export interface RunCreationRequest {
  playbook: Playbook
  input: Record<string, unknown>
}

export const CONTROL_PLANE_SCAFFOLD = {
  package: "@pluto-agent-platform/control-plane",
  purpose: "governed run lifecycle services",
} as const

export * from "./repositories.js"
export * from "./repositories/in-memory.js"
export * from "./services/playbook-service.js"
export * from "./services/harness-service.js"
export * from "./services/role-service.js"
export * from "./services/team-service.js"
export * from "./services/run-state-machine.js"
export * from "./services/run-service.js"
export * from "./services/approval-service.js"
export * from "./services/artifact-service.js"
export * from "./services/run-compiler.js"
export * from "./services/runtime-adapter.js"
export * from "./services/phase-controller.js"
export * from "./services/recovery-service.js"
export * from "./mcp-tools/index.js"
export * from "./paseo/types.js"
export * from "./paseo/fake-agent-manager.js"
export * from "./infrastructure/database/schema.js"
export * from "./infrastructure/database/postgres-repositories.js"
