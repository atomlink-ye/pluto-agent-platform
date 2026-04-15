import type { AssistantMessageItem } from "../types/paseo"

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function AssistantMessageBubble({ item, dark }: { item: AssistantMessageItem; dark?: boolean }) {
  const bubbleClass = dark
    ? "max-w-[75%] rounded-xl rounded-bl-sm bg-slate-800 border border-slate-700 p-3"
    : "max-w-[75%] rounded-xl rounded-bl-sm bg-white border border-slate-200 p-3"
  const textClass = dark ? "text-sm text-slate-200 whitespace-pre-wrap break-words" : "text-sm text-slate-800 whitespace-pre-wrap break-words"
  const timeClass = dark ? "mt-1 text-xs text-slate-500" : "mt-1 text-xs text-slate-400"

  return (
    <div className="flex justify-start">
      <div className={bubbleClass}>
        <p className={textClass}>{item.text}</p>
        <p className={timeClass}>{formatTime(item.timestamp)}</p>
      </div>
    </div>
  )
}
