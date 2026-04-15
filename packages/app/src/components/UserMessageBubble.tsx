import type { UserMessageItem } from "../types/paseo"

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function UserMessageBubble({ item }: { item: UserMessageItem }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-xl rounded-br-sm bg-blue-50 border border-blue-200 p-3">
        <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{item.text}</p>
        {item.images && item.images.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {item.images.map((img, i) => (
              <img
                key={`${item.id}-img-${i}`}
                src={`data:${img.mimeType};base64,${img.data}`}
                alt="Attached"
                className="max-w-48 max-h-48 rounded-lg border border-blue-100"
              />
            ))}
          </div>
        ) : null}
        <p className="mt-1 text-right text-xs text-slate-400">{formatTime(item.timestamp)}</p>
      </div>
    </div>
  )
}
