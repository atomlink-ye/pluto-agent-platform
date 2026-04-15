import { useParams, useNavigate } from "react-router-dom"
import { useAgentStream } from "../hooks/useAgentStream"
import { ChatMessageList } from "../components/ChatMessageList"
import { ChatInputArea } from "../components/ChatInputArea"
import { Badge } from "../components/Badge"
import { Button } from "../components/Button"

export function ChatPage() {
  const { id: runId, agentId } = useParams<{ id: string; agentId: string }>()
  const navigate = useNavigate()

  if (!runId || !agentId) {
    return <p className="p-6 text-sm text-slate-500">Missing run or agent ID.</p>
  }

  return <ChatPageContent runId={runId} agentId={agentId} onBack={() => navigate(`/runs/${runId}`)} />
}

function ChatPageContent({ runId, agentId, onBack }: { runId: string; agentId: string; onBack: () => void }) {
  const stream = useAgentStream({ agentId })

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          &#8592; Back
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-slate-900">
            {stream.agentState?.name ?? agentId}
          </h1>
          {stream.agentState ? (
            <Badge status={stream.agentState.status} />
          ) : null}
        </div>
        <span className="ml-auto font-mono text-xs text-slate-400">Run {runId}</span>
      </div>

      {/* Messages */}
      <ChatMessageList
        items={stream.items}
        isWorking={stream.isWorking}
        hasOlderHistory={stream.hasOlderHistory}
        isLoadingHistory={stream.isLoadingHistory}
        onLoadOlder={stream.fetchOlderHistory}
      />

      {/* Input */}
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
