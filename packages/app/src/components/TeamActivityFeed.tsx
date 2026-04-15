import { useState } from "react"
import type { TeamActivityState } from "../hooks/useTeamActivity"

interface TeamActivityFeedProps {
  teamActivity: TeamActivityState
  onOpenAgent?: (agentId: string) => void
}

const COORDINATION_STYLES: Record<string, string> = {
  supervisor: "bg-blue-50 text-blue-700 border border-blue-200",
  pipeline: "bg-purple-50 text-purple-700 border border-purple-200",
  "shared-room": "bg-teal-50 text-teal-700 border border-teal-200",
  committee: "bg-orange-50 text-orange-700 border border-orange-200",
  unknown: "bg-slate-50 text-slate-500 border border-slate-200",
}

const AGENT_STATUS_STYLES: Record<string, string> = {
  running: "bg-blue-100 text-blue-700",
  idle: "bg-slate-100 text-slate-500",
  done: "bg-emerald-100 text-emerald-700",
  error: "bg-red-100 text-red-600",
}

function formatTime(ts: string): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function getAgentName(agentId: string, agents: TeamActivityState["agents"]): string {
  const agent = agents.find((a) => a.id === agentId)
  return agent?.name ?? agentId
}

export function TeamActivityFeed({ teamActivity, onOpenAgent }: TeamActivityFeedProps) {
  const { coordinationMode, agents, handoffs, activeAgentId } = teamActivity
  const [expanded, setExpanded] = useState(handoffs.length > 0)

  if (agents.length === 0) return null

  const activeName = activeAgentId ? getAgentName(activeAgentId, agents) : null

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-800">Team Activity</span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${COORDINATION_STYLES[coordinationMode]}`}>
            {coordinationMode.replace("-", " ")}
          </span>
          {activeName ? (
            <span className="text-xs text-slate-500">
              Active: <span className="font-medium text-slate-700">{activeName}</span>
            </span>
          ) : null}
        </div>
        <span className="text-slate-400 text-xs">{expanded ? "\u25BE" : "\u25B8"}</span>
      </button>

      {expanded ? (
        <div className="border-t border-slate-200 px-4 py-3 space-y-4">
          {/* Agent status chips */}
          <div className="flex flex-wrap gap-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onOpenAgent?.(agent.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${AGENT_STATUS_STYLES[agent.status]} ${onOpenAgent ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${agent.status === "running" ? "bg-blue-500 animate-pulse" : agent.status === "done" ? "bg-emerald-500" : agent.status === "error" ? "bg-red-500" : "bg-slate-400"}`} />
                {agent.name}
              </button>
            ))}
          </div>

          {/* Handoff feed */}
          {handoffs.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">Recent handoffs</p>
              {handoffs.slice(0, 10).map((handoff) => (
                <div key={handoff.id} className="flex items-start gap-2 text-sm">
                  <span className="shrink-0 text-xs text-slate-400 font-mono w-12">
                    {formatTime(handoff.timestamp)}
                  </span>
                  <span className="text-slate-700">
                    <span className="font-medium">{getAgentName(handoff.fromAgentId, agents)}</span>
                    <span className="text-slate-400 mx-1">{"\u2192"}</span>
                    <span className="font-medium">{getAgentName(handoff.toAgentId, agents)}</span>
                  </span>
                  <span className="text-xs text-slate-500 truncate">
                    {handoff.summaryText.length > 80 ? `${handoff.summaryText.slice(0, 80)}...` : handoff.summaryText}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No handoffs yet.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
