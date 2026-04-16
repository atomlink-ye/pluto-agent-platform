import type { ToolCallItem } from "../types/paseo"

function StatusChip({ status, dark }: { status: "pending" | "done" | "error"; dark?: boolean }) {
  const styles = dark
    ? { pending: "bg-amber-900/50 text-amber-400", done: "bg-emerald-900/50 text-emerald-400", error: "bg-red-900/50 text-red-400" }
    : { pending: "bg-amber-100 text-amber-700", done: "bg-emerald-100 text-emerald-700", error: "bg-red-100 text-red-700" }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  )
}

export function ToolCallBlock({ item, dark }: { item: ToolCallItem; dark?: boolean }) {
  const { payload } = item

  const borderClass = dark ? "border-slate-700" : "border-slate-200"
  const bgClass = payload.status === "pending"
    ? dark ? "animate-pulse bg-amber-900/20" : "animate-pulse bg-amber-50"
    : dark ? "bg-slate-800" : "bg-slate-50"
  const summaryTextClass = dark ? "font-medium text-slate-200" : "font-medium text-slate-700"
  const sectionBorderClass = dark ? "border-slate-700" : "border-slate-200"
  const labelClass = dark ? "text-xs font-medium text-slate-400 mb-1" : "text-xs font-medium text-slate-500 mb-1"
  const preClass = dark
    ? "overflow-x-auto rounded bg-slate-900 border border-slate-700 p-2 font-mono text-xs text-slate-300"
    : "overflow-x-auto rounded bg-white border border-slate-100 p-2 font-mono text-xs text-slate-600"
  const errorLabelClass = dark ? "text-xs font-medium text-red-400 mb-1" : "text-xs font-medium text-red-600 mb-1"
  const errorPreClass = dark
    ? "overflow-x-auto rounded bg-red-900/30 border border-red-800/50 p-2 font-mono text-xs text-red-400"
    : "overflow-x-auto rounded bg-red-50 border border-red-100 p-2 font-mono text-xs text-red-600"

  return (
    <details className={`rounded-lg border ${borderClass} ${bgClass} overflow-hidden`} open={payload.status === "error"}>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
        <span className="text-amber-600">&#9889;</span>
        <span className={summaryTextClass}>{payload.toolName}</span>
        <StatusChip status={payload.status} dark={dark} />
      </summary>
      <div className={`border-t ${sectionBorderClass} px-3 py-2 space-y-2`}>
        {payload.args ? (
          <div>
            <p className={labelClass}>Arguments</p>
            <pre className={preClass}>
              {JSON.stringify(payload.args, null, 2)}
            </pre>
          </div>
        ) : null}
        {payload.result !== undefined ? (
          <div>
            <p className={labelClass}>Result</p>
            <pre className={preClass}>
              {typeof payload.result === "string" ? payload.result : JSON.stringify(payload.result, null, 2)}
            </pre>
          </div>
        ) : null}
        {payload.error ? (
          <div>
            <p className={errorLabelClass}>Error</p>
            <pre className={errorPreClass}>
              {payload.error}
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  )
}
