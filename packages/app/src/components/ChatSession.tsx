import { useAgentStream } from "../hooks/useAgentStream"
import { ChatInputArea } from "./ChatInputArea"
import { ChatMessageList } from "./ChatMessageList"
import { StreamItemRenderer } from "./StreamItemRenderer"
import { Badge } from "./Badge"

export interface ChatSessionProps {
  agentId: string
  runId?: string
  compact?: boolean
  onExpand?: () => void
}

export function ChatSession({ agentId, runId, compact = false, onExpand }: ChatSessionProps) {
  const stream = useAgentStream({ agentId })

  const displayItems = compact ? stream.items.slice(-5) : stream.items

  if (compact) {
    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700">Agent Chat</span>
            {stream.agentState ? (
              <Badge status={stream.agentState.status} />
            ) : null}
          </div>
          {onExpand ? (
            <button
              onClick={onExpand}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
              View full chat &#8594;
            </button>
          ) : null}
        </div>

        {displayItems.length === 0 ? (
          <p className="text-sm text-slate-500">No conversation history yet.</p>
        ) : (
          <div className="space-y-2">
            {stream.items.length > 5 ? (
              <p className="text-xs text-slate-400 text-center">
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
          <div className="flex items-center gap-1 text-xs text-slate-400">
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
