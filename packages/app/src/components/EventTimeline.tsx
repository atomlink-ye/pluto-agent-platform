import type { EventRecord } from "../api"

export interface TimelineEvent {
  id?: string
  type?: string
  timestamp?: string
  message?: string
  eventType?: string
  occurredAt?: string
  payload?: unknown
}

export interface EventTimelineProps {
  events: EventRecord[]
  showRaw?: boolean
  tone?: "light" | "dark"
}

function getEventType(event: TimelineEvent) {
  const type = typeof event.type === "string" ? event.type : event.eventType
  return typeof type === "string" ? type : "event"
}

function getEventTimestamp(event: TimelineEvent) {
  const timestamp = typeof event.timestamp === "string" ? event.timestamp : event.occurredAt
  return typeof timestamp === "string" ? timestamp : undefined
}

function getEventMessage(event: TimelineEvent) {
  if (typeof event.message === "string") {
    return event.message
  }

  if (typeof event.payload === "string") {
    return event.payload
  }

  return undefined
}

function getDotClassName(type: string) {
  if (type.includes("error") || type.includes("fail")) {
    return "bg-red-500"
  }

  if (type.includes("approval") || type.includes("pending")) {
    return "bg-amber-500"
  }

  if (type.includes("phase") || type.includes("run") || type.includes("start")) {
    return "bg-blue-500"
  }

  if (type.includes("success") || type.includes("complete") || type.includes("succeed")) {
    return "bg-emerald-500"
  }

  return "bg-slate-300"
}

function formatDisplayTime(value?: string) {
  if (!value) {
    return ""
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleTimeString()
}

export function EventTimeline({ events, showRaw = false, tone = "light" }: EventTimelineProps) {
  const isDark = tone === "dark"

  if (events.length === 0) {
    return <p className="text-sm text-slate-400">No events yet.</p>
  }

  return (
    <div className="space-y-0">
      {events.map((event, index) => {
        const type = getEventType(event)
        const time = formatDisplayTime(getEventTimestamp(event))
        const message = getEventMessage(event)

        return (
          <div key={event.id ?? `${type}-${index}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={["mt-1 h-2.5 w-2.5 shrink-0 rounded-full", getDotClassName(type)].join(" ")} />
              {index < events.length - 1 ? (
                <div className={isDark ? "my-0.5 w-px flex-1 bg-slate-700" : "my-0.5 w-px flex-1 bg-slate-200"} />
              ) : null}
            </div>

            <div className="min-w-0 flex-1 pb-4">
              <div className="flex items-baseline gap-2">
                <span className={isDark ? "text-sm font-medium capitalize text-slate-100" : "text-sm font-medium capitalize text-slate-800"}>
                  {type.replace(/_/g, " ")}
                </span>
                {time ? (
                  <span className={isDark ? "font-mono text-xs text-slate-500" : "font-mono text-xs text-slate-400"}>{time}</span>
                ) : null}
              </div>

              {message ? <p className={isDark ? "mt-0.5 text-sm text-slate-300" : "mt-0.5 text-sm text-slate-600"}>{message}</p> : null}

              {showRaw ? (
                <pre className={isDark ? "mt-1 overflow-x-auto rounded bg-slate-950 p-2 font-mono text-xs text-slate-400" : "mt-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-xs text-slate-500"}>
                  {JSON.stringify(event, null, 2)}
                </pre>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
