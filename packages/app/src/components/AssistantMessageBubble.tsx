import type { AssistantMessageItem } from "../types/paseo"

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function AssistantMessageBubble({ item }: { item: AssistantMessageItem }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] rounded-xl rounded-bl-sm bg-white border border-slate-200 p-3">
        <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{item.text}</p>
        <p className="mt-1 text-xs text-slate-400">{formatTime(item.timestamp)}</p>
      </div>
    </div>
  )
}
