import type { Playbook, Run } from "../../contracts/src/index.js"

export interface RunCreationRequest {
  playbook: Playbook
  input: Record<string, unknown>
}

export interface RunRepository {
  save(run: Run): Promise<void>
  getById(id: string): Promise<Run | null>
}

export const CONTROL_PLANE_SCAFFOLD = {
  package: "@pluto-agent-platform/control-plane",
  purpose: "governed run lifecycle services",
} as const
