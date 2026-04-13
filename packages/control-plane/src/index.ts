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
export * from "./services/run-state-machine.js"
export * from "./services/run-service.js"
export * from "./services/approval-service.js"
export * from "./services/artifact-service.js"
