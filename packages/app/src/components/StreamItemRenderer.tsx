import type { StreamItem } from "../types/paseo"
import { AssistantMessageBubble } from "./AssistantMessageBubble"
import { CompactionMarker } from "./CompactionMarker"
import { ThoughtBlock } from "./ThoughtBlock"
import { TodoListBlock } from "./TodoListBlock"
import { ToolCallBlock } from "./ToolCallBlock"
import { UserMessageBubble } from "./UserMessageBubble"

export function StreamItemRenderer({ item }: { item: StreamItem }) {
  switch (item.kind) {
    case "user_message":
      return <UserMessageBubble item={item} />
    case "assistant_message":
      return <AssistantMessageBubble item={item} />
    case "thought":
      return <ThoughtBlock item={item} />
    case "tool_call":
      return <ToolCallBlock item={item} />
    case "todo_list":
      return <TodoListBlock item={item} />
    case "compaction":
      return <CompactionMarker />
    case "activity_log":
      return (
        <div className="flex justify-start">
          <div className={`max-w-[75%] rounded-lg border p-2 text-xs ${item.level === "error" ? "border-red-200 bg-red-50 text-red-700" : item.level === "warn" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
            <span className="font-medium uppercase">{item.level}</span> {item.message}
          </div>
        </div>
      )
    default:
      return null
  }
}
