import type { UserMessageItem } from "../types/paseo"

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function UserMessageBubble({ item, dark }: { item: UserMessageItem; dark?: boolean }) {
  const bubbleClass = dark
    ? "max-w-[75%] rounded-xl rounded-br-sm bg-blue-900/30 border border-blue-800/50 p-3"
    : "max-w-[75%] rounded-xl rounded-br-sm bg-blue-50 border border-blue-200 p-3"
  const textClass = dark ? "text-sm text-slate-200 whitespace-pre-wrap break-words" : "text-sm text-slate-800 whitespace-pre-wrap break-words"
  const imgBorderClass = dark ? "border-blue-800/50" : "border-blue-100"
  const timeClass = dark ? "mt-1 text-right text-xs text-slate-500" : "mt-1 text-right text-xs text-slate-400"

  return (
    <div className="flex justify-end">
      <div className={bubbleClass}>
        <p className={textClass}>{item.text}</p>
        {item.images && item.images.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {item.images.map((img, i) => (
              <img
                key={`${item.id}-img-${i}`}
                src={`data:${img.mimeType};base64,${img.data}`}
                alt="Attached"
                className={`max-w-48 max-h-48 rounded-lg border ${imgBorderClass}`}
              />
            ))}
          </div>
        ) : null}
        <p className={timeClass}>{formatTime(item.timestamp)}</p>
      </div>
    </div>
  )
}
