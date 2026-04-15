import type { StreamItem } from "../types/paseo"
import { AssistantMessageBubble } from "./AssistantMessageBubble"
import { CompactionMarker } from "./CompactionMarker"
import { ThoughtBlock } from "./ThoughtBlock"
import { TodoListBlock } from "./TodoListBlock"
import { ToolCallBlock } from "./ToolCallBlock"
import { UserMessageBubble } from "./UserMessageBubble"

export function StreamItemRenderer({ item, dark }: { item: StreamItem; dark?: boolean }) {
  switch (item.kind) {
    case "user_message":
      return <UserMessageBubble item={item} dark={dark} />
    case "assistant_message":
      return <AssistantMessageBubble item={item} dark={dark} />
    case "thought":
      return <ThoughtBlock item={item} dark={dark} />
    case "tool_call":
      return <ToolCallBlock item={item} dark={dark} />
    case "todo_list":
      return <TodoListBlock item={item} dark={dark} />
    case "compaction":
      return <CompactionMarker dark={dark} />
    case "activity_log": {
      const baseClass = dark
        ? item.level === "error" ? "border-red-800/50 bg-red-900/30 text-red-400"
          : item.level === "warn" ? "border-amber-800/50 bg-amber-900/30 text-amber-400"
          : "border-slate-700 bg-slate-800 text-slate-400"
        : item.level === "error" ? "border-red-200 bg-red-50 text-red-700"
          : item.level === "warn" ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-50 text-slate-600"
      return (
        <div className="flex justify-start">
          <div className={`max-w-[75%] rounded-lg border p-2 text-xs ${baseClass}`}>
            <span className="font-medium uppercase">{item.level}</span> {item.message}
          </div>
        </div>
      )
    }
    default:
      return null
  }
}
