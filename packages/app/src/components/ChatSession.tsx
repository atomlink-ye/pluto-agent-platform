import { useAgentStream } from "../hooks/useAgentStream"
import { ChatInputArea } from "./ChatInputArea"
import { ChatMessageList } from "./ChatMessageList"
import { StreamItemRenderer } from "./StreamItemRenderer"
import { Badge } from "./Badge"
import { Button } from "./Button"

export interface ChatSessionProps {
  agentId: string
  runId?: string
  compact?: boolean
  onExpand?: () => void
  dark?: boolean
}

export function ChatSession({ agentId, runId, compact = false, onExpand, dark = false }: ChatSessionProps) {
  const stream = useAgentStream({ agentId })

  const displayItems = compact ? stream.items.slice(-5) : stream.items

  if (compact) {
    const containerClassName = dark
      ? "space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-5"
      : "space-y-3 rounded-xl border border-slate-200 bg-white p-5"
    const titleClassName = dark ? "text-sm font-medium text-slate-100" : "text-sm font-medium text-slate-700"
    const emptyClassName = dark ? "text-sm text-slate-400" : "text-sm text-slate-500"
    const noteClassName = dark ? "text-center text-xs text-slate-500" : "text-center text-xs text-slate-400"
    const workingClassName = dark ? "flex items-center gap-1 text-xs text-slate-500" : "flex items-center gap-1 text-xs text-slate-400"

    return (
      <div className={containerClassName}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={titleClassName}>Agent Chat</span>
            {stream.agentState ? (
              <Badge status={stream.agentState.status} />
            ) : null}
          </div>
          {onExpand ? (
            <Button variant={dark ? "secondary" : "ghost"} size="sm" onClick={onExpand} className={dark ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white" : ""}>
              View full chat &#8594;
            </Button>
          ) : null}
        </div>

        {displayItems.length === 0 ? (
          <p className={emptyClassName}>No conversation history yet.</p>
        ) : (
          <div className="space-y-2">
            {stream.items.length > 5 ? (
              <p className={noteClassName}>
                Showing last 5 of {stream.items.length} messages
              </p>
            ) : null}
            <div className="space-y-2">
              {displayItems.map((item) => (
                <StreamItemRenderer key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {stream.isWorking ? (
          <div className={workingClassName}>
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
            Agent is working...
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <ChatMessageList
        items={stream.items}
        isWorking={stream.isWorking}
        hasOlderHistory={stream.hasOlderHistory}
        isLoadingHistory={stream.isLoadingHistory}
        onLoadOlder={stream.fetchOlderHistory}
      />
      <ChatInputArea
        disabled={!stream.isWorking && stream.agentState?.status === "done"}
        connectionState={stream.connectionState}
        onSend={async (text) => {
          const result = await stream.sendMessage(text)
          if (!result.accepted) {
            console.error("Failed to send message:", result.error)
          }
        }}
      />
    </div>
  )
}
