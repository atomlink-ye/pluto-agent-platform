import type { FC } from "react"

export const WorkingIndicator: FC<{ visible: boolean; dark?: boolean }> = ({ visible, dark }) => {
  if (!visible) return null
  const textClass = dark ? "text-xs text-slate-400" : "text-xs text-slate-500"
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />
      <span className={textClass}>Agent is working...</span>
    </div>
  )
}
