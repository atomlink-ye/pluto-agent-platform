import { useMemo } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { useAgentStream } from "../hooks/useAgentStream"
import { ChatMessageList } from "../components/ChatMessageList"
import { ChatInputArea } from "../components/ChatInputArea"
import { Badge } from "../components/Badge"
import { Button } from "../components/Button"
import { usePageChrome } from "../components/Layout"

type ChatPageLocationState = { agentLabel?: string; runName?: string } | null

export function ChatPage() {
  const { id: runId, agentId } = useParams<{ id: string; agentId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state as ChatPageLocationState | undefined) ?? null

  if (!runId || !agentId) {
    return <p className="p-6 text-sm text-slate-500">Missing run or agent ID.</p>
  }

  return (
    <ChatPageContent
      runId={runId}
      agentId={agentId}
      state={state}
      onBack={() => navigate(`/runs/${runId}`)}
    />
  )
}

function ChatPageContent({
  runId,
  agentId,
  state,
  onBack,
}: {
  runId: string
  agentId: string
  state: ChatPageLocationState
  onBack: () => void
}) {
  const stream = useAgentStream({ agentId })
  const agentLabel = state?.agentLabel ?? stream.agentState?.name ?? agentId
  const runName = state?.runName ?? runId
  const runReference = useMemo(() => {
    return runName === runId ? `Run ${runId}` : `${runName} · ${runId}`
  }, [runId, runName])

  usePageChrome({
    breadcrumbs: [{ label: "Runs", href: "/runs" }, { label: runName, href: `/runs/${runId}` }, { label: "Agent Chat" }],
  })

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          &#8592; Back
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-slate-900">Agent Chat</h1>
            {stream.agentState ? (
              <Badge status={stream.agentState.status} />
            ) : null}
          </div>
          <p className="truncate text-xs text-slate-500">
            <span className="font-medium text-slate-700">{agentLabel}</span>
            <span className="px-1.5 text-slate-300">•</span>
            <span>{runReference}</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {stream.agentState ? (
            <span className="hidden text-xs text-slate-500 sm:inline">{stream.agentState.name ?? agentLabel}</span>
          ) : null}
        </div>
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
