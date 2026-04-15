import type { SocketState } from "../hooks/usePaseoSocket"

export type OperatorAgentStatus = "idle" | "running" | "waiting" | "done" | "error"

type OperatorStatusColor = "slate" | "blue" | "amber" | "red" | "green"

interface OperatorStatus {
  label: string
  color: OperatorStatusColor
  animated: boolean
}

export interface RuntimeStatusBarProps {
  agentStatus?: OperatorAgentStatus
  socketState: SocketState
  className?: string
}

const COLOR_STYLES: Record<OperatorStatusColor, string> = {
  slate: "bg-gray-400 dark:bg-gray-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  green: "bg-green-500",
}

export function getOperatorStatus(
  agentStatus: OperatorAgentStatus | undefined,
  socketState: SocketState,
): OperatorStatus {
  switch (socketState) {
    case "connecting":
      return { label: "Connecting...", color: "slate", animated: true }
    case "handshaking":
      return { label: "Establishing connection...", color: "slate", animated: true }
    case "reconnecting":
      return { label: "Reconnecting...", color: "amber", animated: true }
    case "error":
      return { label: "Connection error", color: "red", animated: false }
    case "closed":
      return { label: "Disconnected", color: "red", animated: false }
    case "ready":
      switch (agentStatus ?? "idle") {
        case "running":
          return { label: "Working", color: "blue", animated: true }
        case "waiting":
          return { label: "Waiting for input", color: "amber", animated: false }
        case "done":
          return { label: "Completed", color: "green", animated: false }
        case "error":
          return { label: "Agent error", color: "red", animated: false }
        case "idle":
        default:
          return { label: "Idle", color: "slate", animated: false }
      }
  }
}

export function RuntimeStatusBar({ agentStatus, socketState, className = "" }: RuntimeStatusBarProps) {
  const status = getOperatorStatus(agentStatus, socketState)

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 ${className}`}>
      <span
        className={`h-2 w-2 rounded-full ${COLOR_STYLES[status.color]} ${status.animated ? "animate-pulse" : ""}`}
        aria-hidden="true"
      />
      <span>{status.label}</span>
    </div>
  )
}
