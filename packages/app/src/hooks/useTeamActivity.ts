import { useEffect, useMemo, useRef, useState } from "react"
import type { AgentStateMessage, AgentStreamMessage, WsServerMessage } from "../types/paseo"
import { usePaseoSocketContext } from "./PaseoSocketContext"

export interface TeamAgent {
  id: string
  name: string
  roleId: string
  status: "idle" | "running" | "done" | "error"
  lastActiveAt?: string
}

export interface TeamHandoff {
  id: string
  fromAgentId: string
  toAgentId: string
  timestamp: string
  summaryText: string
}

export interface TeamActivityState {
  coordinationMode: "supervisor" | "pipeline" | "shared-room" | "committee" | "unknown"
  agents: TeamAgent[]
  handoffs: TeamHandoff[]
  activeAgentId: string | null
}

export interface TeamActivityOptions {
  runId: string
  resolvedTeam: {
    roles?: Array<{ id: string; name: string; agentId?: string }>
    coordination?: string | Record<string, unknown>
  } | null
}

export function useTeamActivity(options: TeamActivityOptions): TeamActivityState {
  const { resolvedTeam } = options
  const socket = usePaseoSocketContext()

  const [agents, setAgents] = useState<TeamAgent[]>(() => {
    if (!resolvedTeam?.roles) return []
    return resolvedTeam.roles.map((role) => ({
      id: role.agentId ?? role.id,
      name: role.name,
      roleId: role.id,
      status: "idle" as const,
    }))
  })

  const [handoffs, setHandoffs] = useState<TeamHandoff[]>([])
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const lastStreamAgentRef = useRef<string | null>(null)

  const coordinationMode = useMemo((): TeamActivityState["coordinationMode"] => {
    const raw = resolvedTeam?.coordination
    const mode = typeof raw === "string" ? raw : typeof raw === "object" && raw !== null && "mode" in raw ? String(raw.mode) : undefined
    if (mode === "supervisor" || mode === "pipeline" || mode === "shared-room" || mode === "committee") {
      return mode
    }
    return "unknown"
  }, [resolvedTeam?.coordination])

  const agentIds = useMemo(() => {
    return new Set(agents.map((a) => a.id))
  }, [agents])

  // Subscribe to agent_state
  useEffect(() => {
    return socket.addListener("agent_state", (msg: WsServerMessage) => {
      const stateMsg = msg as AgentStateMessage
      const agentId = stateMsg.agent.id
      if (!agentIds.has(agentId)) return

      setAgents((prev) =>
        prev.map((a) => {
          if (a.id !== agentId) return a
          const newStatus = stateMsg.agent.status === "waiting" ? "idle" : stateMsg.agent.status
          return {
            ...a,
            status: newStatus as TeamAgent["status"],
            lastActiveAt: new Date().toISOString(),
          }
        })
      )

      if (stateMsg.agent.status === "running") {
        setActiveAgentId(agentId)
      }
    })
  }, [socket, agentIds])

  // Subscribe to agent_stream for handoff detection
  useEffect(() => {
    return socket.addListener("agent_stream", (msg: WsServerMessage) => {
      const streamMsg = msg as AgentStreamMessage
      if (!agentIds.has(streamMsg.agentId)) return

      const item = streamMsg.event.item
      if (item.kind === "user_message" && lastStreamAgentRef.current && lastStreamAgentRef.current !== streamMsg.agentId) {
        const handoff: TeamHandoff = {
          id: crypto.randomUUID(),
          fromAgentId: lastStreamAgentRef.current,
          toAgentId: streamMsg.agentId,
          timestamp: new Date().toISOString(),
          summaryText: item.text.slice(0, 120),
        }
        setHandoffs((prev) => [handoff, ...prev].slice(0, 50))
      }
      lastStreamAgentRef.current = streamMsg.agentId
    })
  }, [socket, agentIds])

  return { coordinationMode, agents, handoffs, activeAgentId }
}
