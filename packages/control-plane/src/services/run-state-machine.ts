import type { RunStatus } from "@pluto-agent-platform/contracts"

const allowedTransitions: Record<RunStatus, RunStatus[]> = {
  queued: ["initializing"],
  initializing: ["running"],
  running: ["blocked", "waiting_approval", "failing", "failed", "succeeded", "canceled"],
  blocked: ["running", "failed", "canceled"],
  waiting_approval: ["running", "failed", "canceled"],
  failing: ["running", "failed"],
  failed: ["archived"],
  succeeded: ["archived"],
  canceled: ["archived"],
  archived: [],
}

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  "failed",
  "succeeded",
  "canceled",
  "archived",
])

export const isTerminalRunStatus = (status: RunStatus): boolean =>
  TERMINAL_RUN_STATUSES.has(status)

export const canTransition = (currentStatus: RunStatus, targetStatus: RunStatus): boolean =>
  allowedTransitions[currentStatus].includes(targetStatus)

export const transition = (currentStatus: RunStatus, targetStatus: RunStatus): RunStatus => {
  if (!canTransition(currentStatus, targetStatus)) {
    throw new Error(`Invalid run status transition: ${currentStatus} -> ${targetStatus}`)
  }

  return targetStatus
}
