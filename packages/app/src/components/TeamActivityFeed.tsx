import { useState } from "react"
import type { TeamActivityState } from "../hooks/useTeamActivity"
import { Button } from "./Button"

interface TeamActivityFeedProps {
  teamActivity: TeamActivityState
  onOpenAgent?: (agentId: string) => void
  dark?: boolean
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

export function TeamActivityFeed({ teamActivity, onOpenAgent, dark = false }: TeamActivityFeedProps) {
  const { coordinationMode, agents, handoffs, activeAgentId } = teamActivity
  const [expanded, setExpanded] = useState(handoffs.length > 0)

  if (agents.length === 0) return null

  const activeName = activeAgentId ? getAgentName(activeAgentId, agents) : null
  const coordinationStyles = dark
    ? {
        supervisor: "border border-blue-500/30 bg-blue-500/10 text-blue-200",
        pipeline: "border border-purple-500/30 bg-purple-500/10 text-purple-200",
        "shared-room": "border border-teal-500/30 bg-teal-500/10 text-teal-200",
        committee: "border border-orange-500/30 bg-orange-500/10 text-orange-200",
        unknown: "border border-slate-700 bg-slate-800 text-slate-300",
      }
    : COORDINATION_STYLES
  const agentStatusStyles = dark
    ? {
        running: "bg-blue-500/15 text-blue-200",
        idle: "bg-slate-800 text-slate-300",
        done: "bg-emerald-500/15 text-emerald-200",
        error: "bg-red-500/15 text-red-200",
      }
    : AGENT_STATUS_STYLES
  const containerClassName = dark ? "rounded-xl border border-slate-800 bg-slate-900 overflow-hidden" : "rounded-xl border border-slate-200 bg-white overflow-hidden"
  const headerClassName = dark
    ? "flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-800"
    : "flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50"
  const titleClassName = dark ? "text-sm font-semibold text-white" : "text-sm font-semibold text-slate-800"
  const activeTextClassName = dark ? "text-xs text-slate-400" : "text-xs text-slate-500"
  const activeNameClassName = dark ? "font-medium text-slate-200" : "font-medium text-slate-700"
  const caretClassName = dark ? "text-slate-500 text-xs" : "text-slate-400 text-xs"
  const contentClassName = dark ? "border-t border-slate-800 px-4 py-3 space-y-4" : "border-t border-slate-200 px-4 py-3 space-y-4"
  const handoffLabelClassName = dark ? "text-xs font-medium text-slate-500" : "text-xs font-medium text-slate-500"
  const handoffTimeClassName = dark ? "shrink-0 text-xs text-slate-500 font-mono w-12" : "shrink-0 text-xs text-slate-400 font-mono w-12"
  const handoffTextClassName = dark ? "text-slate-300" : "text-slate-700"
  const handoffArrowClassName = dark ? "text-slate-600 mx-1" : "text-slate-400 mx-1"
  const handoffSummaryClassName = dark ? "text-xs text-slate-400 truncate" : "text-xs text-slate-500 truncate"
  const emptyClassName = dark ? "text-xs text-slate-500" : "text-xs text-slate-400"

  return (
    <div className={containerClassName}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(!expanded)}
        className={headerClassName}
      >
        <div className="flex items-center gap-3">
          <span className={titleClassName}>Team Activity</span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${coordinationStyles[coordinationMode] ?? coordinationStyles.unknown}`}>
            {coordinationMode.replace("-", " ")}
          </span>
          {activeName ? (
            <span className={activeTextClassName}>
              Active: <span className={activeNameClassName}>{activeName}</span>
            </span>
          ) : null}
        </div>
        <span className={caretClassName}>{expanded ? "\u25BE" : "\u25B8"}</span>
      </Button>

      {expanded ? (
        <div className={contentClassName}>
          <div className="flex flex-wrap gap-2">
            {agents.map((agent) => (
              <Button
                key={agent.id}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenAgent?.(agent.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${agentStatusStyles[agent.status] ?? agentStatusStyles.idle} ${onOpenAgent ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${agent.status === "running" ? "bg-blue-500 animate-pulse" : agent.status === "done" ? "bg-emerald-500" : agent.status === "error" ? "bg-red-500" : "bg-slate-400"}`} />
                {agent.name}
              </Button>
            ))}
          </div>

          {handoffs.length > 0 ? (
            <div className="space-y-2">
              <p className={handoffLabelClassName}>Recent handoffs</p>
              {handoffs.slice(0, 10).map((handoff) => (
                <div key={handoff.id} className="flex items-start gap-2 text-sm">
                  <span className={handoffTimeClassName}>
                    {formatTime(handoff.timestamp)}
                  </span>
                  <span className={handoffTextClassName}>
                    <span className="font-medium">{getAgentName(handoff.fromAgentId, agents)}</span>
                    <span className={handoffArrowClassName}>{"\u2192"}</span>
                    <span className="font-medium">{getAgentName(handoff.toAgentId, agents)}</span>
                  </span>
                  <span className={handoffSummaryClassName}>
                    {handoff.summaryText.length > 80 ? `${handoff.summaryText.slice(0, 80)}...` : handoff.summaryText}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={emptyClassName}>No handoffs yet.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
