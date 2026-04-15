import type { FC } from "react"

export const WorkingIndicator: FC<{ visible: boolean }> = ({ visible }) => {
  if (!visible) return null
  return (
    <div className="flex items-center gap-1 px-4 py-2">
      <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="h-2 w-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
    </div>
  )
}
