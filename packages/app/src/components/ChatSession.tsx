import type { SessionRecord } from "../api"
import { Badge } from "./Badge"
import { Card } from "./Card"

export interface ChatSessionProps {
  runId: string
  sessions: SessionRecord[]
  tone?: "light" | "dark"
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null
}

function isString(val: unknown): val is string {
  return typeof val === "string"
}

interface NormalizedToolCall {
  id: string
  name: string
  details: string
}

interface NormalizedMessage {
  id: string
  role: "user" | "agent" | "tool"
  content: string
  toolCalls: NormalizedToolCall[]
  timestamp?: string
}

interface NormalizedSession {
  id: string
  title: string
  status?: string
  messages: NormalizedMessage[]
}

function normalizeToolCall(raw: unknown, fallbackId: string): NormalizedToolCall {
  if (!isObject(raw)) {
    return { id: fallbackId, name: "Unknown Tool", details: String(raw) }
  }

  const id = isString(raw.id) ? raw.id : fallbackId
  const name = isString(raw.name)
    ? raw.name
    : isString(raw.toolName)
      ? raw.toolName
      : isString(raw.tool_name)
        ? raw.tool_name
        : "Unknown Tool"

  let details = ""
  if (isString(raw.details)) details = raw.details
  else if (isString(raw.arguments)) details = raw.arguments
  else if (isObject(raw.arguments)) details = JSON.stringify(raw.arguments, null, 2)
  else if (isObject(raw.payload)) details = JSON.stringify(raw.payload, null, 2)
  else details = JSON.stringify(raw, null, 2)

  return { id, name, details }
}

function normalizeMessage(raw: unknown, fallbackId: string): NormalizedMessage {
  if (!isObject(raw)) {
    return {
      id: fallbackId,
      role: "agent",
      content: String(raw),
      toolCalls: [],
    }
  }

  let role: "user" | "agent" | "tool" = "agent"
  const rawRole = isString(raw.role) ? raw.role.toLowerCase() : isString(raw.sender) ? raw.sender.toLowerCase() : ""
  if (rawRole.includes("user")) role = "user"
  else if (rawRole.includes("tool") || rawRole.includes("function")) role = "tool"

  let content = ""
  if (isString(raw.content)) content = raw.content
  else if (isString(raw.message)) content = raw.message
  else if (isString(raw.text)) content = raw.text
  else content = "No content"

  const toolCalls: NormalizedToolCall[] = []
  const rawToolCalls = raw.toolCalls ?? raw.tool_calls
  if (Array.isArray(rawToolCalls)) {
    rawToolCalls.forEach((tc, idx) => toolCalls.push(normalizeToolCall(tc, `${fallbackId}-tc-${idx}`)))
  }

  if (role === "tool" && toolCalls.length === 0) {
    const name = isString(raw.name) ? raw.name : isString(raw.toolName) ? raw.toolName : "Tool"
    toolCalls.push({
      id: `${fallbackId}-tc-self`,
      name,
      details: content,
    })
    content = `${name} executed`
  }

  return {
    id: isString(raw.id) ? raw.id : fallbackId,
    role,
    content,
    toolCalls,
    timestamp: isString(raw.timestamp) ? raw.timestamp : isString(raw.createdAt) ? raw.createdAt : undefined,
  }
}

function normalizeSession(raw: unknown, fallbackId: string): NormalizedSession {
  if (!isObject(raw)) {
    return { id: fallbackId, title: "Unknown Session", messages: [] }
  }

  const messages: NormalizedMessage[] = []
  const rawMessages = raw.messages ?? raw.history ?? raw.events
  if (Array.isArray(rawMessages)) {
    rawMessages.forEach((message, idx) => messages.push(normalizeMessage(message, `${fallbackId}-m-${idx}`)))
  }

  const id = isString(raw.id) ? raw.id : isString(raw.session_id) ? raw.session_id : fallbackId
  const provider = isString(raw.provider) ? raw.provider : isString(raw.role_id) ? raw.role_id : undefined

  return {
    id,
    title: provider ?? id,
    status: isString(raw.status) ? raw.status : undefined,
    messages,
  }
}

function formatTime(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString()
}

export function ChatSession({ runId, sessions, tone = "light" }: ChatSessionProps) {
  const isDark = tone === "dark"

  const normalizedSessions = Array.isArray(sessions)
    ? sessions.map((session, idx) => normalizeSession(session, `session-${idx}`))
    : []

  const allMessages = normalizedSessions.flatMap((session) => session.messages)

  return (
    <div className="space-y-4">
      {normalizedSessions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {normalizedSessions.map((session) => (
            <div
              key={session.id}
              className={isDark ? "rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300" : "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600"}
            >
              <span className={isDark ? "font-medium text-slate-100" : "font-medium text-slate-800"}>{session.title}</span>
              {session.status ? (
                <>
                  <span className={isDark ? "mx-1 text-slate-500" : "mx-1 text-slate-400"}>·</span>
                  <Badge status={session.status} />
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className={isDark ? "space-y-3 rounded-xl border border-slate-700 bg-slate-950 p-4" : "space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"}>
        {allMessages.length === 0 ? (
          <Card className={isDark ? "border-slate-800 bg-slate-900 p-4" : "p-4"}>
            <p className={isDark ? "text-sm text-slate-400" : "text-sm text-slate-500"}>
              No conversation history available for {runId}.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {allMessages.map((entry) => (
              <div key={entry.id} className={entry.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <Card
                  className={[
                    "max-w-3xl p-3",
                    isDark ? "border-slate-800 bg-slate-900" : "bg-white",
                    entry.role === "user" ? (isDark ? "border-blue-800 bg-blue-950" : "border-blue-200 bg-blue-50") : "",
                    entry.role === "tool" ? (isDark ? "border-amber-800 bg-amber-950/40" : "border-amber-200 bg-amber-50") : "",
                  ].join(" ")}
                >
                  <div className={isDark ? "flex items-center gap-2 text-xs text-slate-400" : "flex items-center gap-2 text-xs text-slate-500"}>
                    <span className={isDark ? "font-medium text-slate-200" : "font-medium text-slate-700"}>
                      {entry.role === "user" ? "User" : entry.role === "tool" ? "Tool" : "Agent"}
                    </span>
                    {entry.timestamp ? <span className="font-mono">{formatTime(entry.timestamp)}</span> : null}
                  </div>

                  <pre
                    style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                    className={isDark ? "mt-2 font-sans text-sm leading-relaxed text-slate-100" : "mt-2 font-sans text-sm leading-relaxed text-slate-800"}
                  >
                    {entry.content}
                  </pre>

                  {entry.toolCalls.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {entry.toolCalls.map((toolCall) => (
                        <details
                          key={toolCall.id}
                          className={isDark ? "rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-300" : "rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600"}
                        >
                          <summary className={isDark ? "flex cursor-pointer items-center gap-1 font-medium text-slate-200" : "flex cursor-pointer items-center gap-1 font-medium text-slate-700"}>
                            <span className="text-amber-600">⚡</span> {toolCall.name}
                          </summary>
                          <pre className={isDark ? "mt-2 overflow-x-auto rounded border border-slate-800 bg-slate-900 p-2 font-mono text-xs text-slate-300" : "mt-2 overflow-x-auto rounded border border-slate-100 bg-white p-2 font-mono text-xs text-slate-600"}>
                            {toolCall.details}
                          </pre>
                        </details>
                      ))}
                    </div>
                  ) : null}
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
