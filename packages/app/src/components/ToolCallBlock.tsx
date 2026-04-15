import type { ToolCallItem } from "../types/paseo"

function StatusChip({ status }: { status: "pending" | "done" | "error" }) {
  const styles = {
    pending: "bg-amber-100 text-amber-700",
    done: "bg-emerald-100 text-emerald-700",
    error: "bg-red-100 text-red-700",
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  )
}

export function ToolCallBlock({ item }: { item: ToolCallItem }) {
  const { payload } = item
  const bgClass = payload.status === "pending" ? "animate-pulse bg-amber-50" : "bg-slate-50"

  return (
    <details className={`rounded-lg border border-slate-200 ${bgClass} overflow-hidden`}>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
        <span className="text-amber-600">&#9889;</span>
        <span className="font-medium text-slate-700">{payload.toolName}</span>
        <StatusChip status={payload.status} />
      </summary>
      <div className="border-t border-slate-200 px-3 py-2 space-y-2">
        {payload.args ? (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Arguments</p>
            <pre className="overflow-x-auto rounded bg-white border border-slate-100 p-2 font-mono text-xs text-slate-600">
              {JSON.stringify(payload.args, null, 2)}
            </pre>
          </div>
        ) : null}
        {payload.result !== undefined ? (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Result</p>
            <pre className="overflow-x-auto rounded bg-white border border-slate-100 p-2 font-mono text-xs text-slate-600">
              {typeof payload.result === "string" ? payload.result : JSON.stringify(payload.result, null, 2)}
            </pre>
          </div>
        ) : null}
        {payload.error ? (
          <div>
            <p className="text-xs font-medium text-red-600 mb-1">Error</p>
            <pre className="overflow-x-auto rounded bg-red-50 border border-red-100 p-2 font-mono text-xs text-red-600">
              {payload.error}
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  )
}
