import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  AgentSnapshot,
  AgentStateMessage,
  AgentStreamMessage,
  FetchTimelineRequest,
  FetchTimelineResponse,
  SendMessageRequest,
  SendResult,
  StreamItem,
  TimelineCursor,
  WsServerMessage,
} from "../types/paseo"
import { usePaseoSocketContext } from "./PaseoSocketContext"
import type { SocketState } from "./usePaseoSocket"

export interface AgentStreamOptions {
  agentId: string
  autoFetchTimeline?: boolean
  tailLimit?: number
}

export interface AgentStreamHandle {
  items: StreamItem[]
  agentState: AgentSnapshot | null
  isWorking: boolean
  hasOlderHistory: boolean
  isLoadingHistory: boolean
  connectionState: SocketState
  fetchOlderHistory: () => void
  sendMessage: (text: string) => Promise<SendResult>
}

export function useAgentStream(options: AgentStreamOptions): AgentStreamHandle {
  const { agentId, autoFetchTimeline = true, tailLimit = 50 } = options
  const socket = usePaseoSocketContext()

  const [items, setItems] = useState<StreamItem[]>([])
  const [agentState, setAgentState] = useState<AgentSnapshot | null>(null)
  const [hasOlderHistory, setHasOlderHistory] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

  const pendingRequestsRef = useRef<Map<string, (msg: WsServerMessage) => void>>(new Map())
  const oldestCursorRef = useRef<TimelineCursor | null>(null)
  const historyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeAgentIdRef = useRef(agentId)
  const requestEpochRef = useRef(0)
  const lastFetchedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    activeAgentIdRef.current = agentId
    requestEpochRef.current += 1
    pendingRequestsRef.current.clear()
    if (historyTimeoutRef.current) {
      clearTimeout(historyTimeoutRef.current)
      historyTimeoutRef.current = null
    }
    oldestCursorRef.current = null
    lastFetchedKeyRef.current = null
    setItems([])
    setAgentState(null)
    setHasOlderHistory(false)
    setIsLoadingHistory(false)
  }, [agentId])

  // Subscribe to agent_state
  useEffect(() => {
    return socket.addListener("agent_state", (msg) => {
      const stateMsg = msg as AgentStateMessage
      if (stateMsg.agent.id === agentId) {
        setAgentState(stateMsg.agent)
      }
    })
  }, [socket, agentId])

  // Subscribe to agent_stream
  useEffect(() => {
    return socket.addListener("agent_stream", (msg) => {
      const streamMsg = msg as AgentStreamMessage
      if (streamMsg.agentId === agentId) {
        setItems((prev) => {
          const newItem = streamMsg.event.item
          if (prev.some((i) => i.id === newItem.id)) return prev
          return [...prev, newItem]
        })
      }
    })
  }, [socket, agentId])

  // Listen for timeline responses
  useEffect(() => {
    return socket.addListener("fetch_agent_timeline_response", (msg) => {
      const resp = msg as FetchTimelineResponse
      const handler = pendingRequestsRef.current.get(resp.requestId)
      if (handler) {
        handler(msg)
        pendingRequestsRef.current.delete(resp.requestId)
      }
    })
  }, [socket])

  // Listen for send_message responses
  useEffect(() => {
    return socket.addListener("send_agent_message_response", (msg) => {
      const handler = pendingRequestsRef.current.get((msg as { payload: { requestId: string } }).payload.requestId)
      if (handler) {
        handler(msg)
        pendingRequestsRef.current.delete((msg as { payload: { requestId: string } }).payload.requestId)
      }
    })
  }, [socket])

  // Auto-fetch timeline when socket becomes ready (including after reconnect)
  useEffect(() => {
    if (!autoFetchTimeline || socket.state !== "ready") {
      // Reset when socket loses ready state so reconnect triggers a re-fetch
      if (socket.state !== "ready") {
        lastFetchedKeyRef.current = null
      }
      return
    }
    const fetchKey = `${agentId}:${socket.state}`
    if (lastFetchedKeyRef.current === fetchKey) return
    lastFetchedKeyRef.current = fetchKey

    const requestId = crypto.randomUUID()
    const requestEpoch = requestEpochRef.current
    const req: FetchTimelineRequest = {
      type: "fetch_agent_timeline_request",
      agentId,
      requestId,
      direction: "tail",
      limit: tailLimit,
    }

    pendingRequestsRef.current.set(requestId, (msg) => {
      if (requestEpoch !== requestEpochRef.current || activeAgentIdRef.current !== agentId) {
        return
      }

      const resp = msg as FetchTimelineResponse
      const newItems = resp.rows.map((r) => r.item)
      setItems((prev) => {
        const ids = new Set(prev.map((i) => i.id))
        const merged = [...prev]
        for (const item of newItems) {
          if (!ids.has(item.id)) {
            merged.push(item)
            ids.add(item.id)
          }
        }
        return merged.sort((a, b) => a.timestamp - b.timestamp)
      })
      setHasOlderHistory(resp.hasOlder)
      if (resp.rows.length > 0) {
        oldestCursorRef.current = {
          epoch: resp.epoch,
          seq: resp.rows[0].seq,
        }
      }
    })

    socket.send(req)
  }, [agentId, autoFetchTimeline, tailLimit, socket.state, socket.send])

  const fetchOlderHistory = useCallback(() => {
    if (isLoadingHistory || !hasOlderHistory || !oldestCursorRef.current) return
    setIsLoadingHistory(true)

    const requestId = crypto.randomUUID()
    const requestEpoch = requestEpochRef.current
    const req: FetchTimelineRequest = {
      type: "fetch_agent_timeline_request",
      agentId,
      requestId,
      direction: "before",
      cursor: oldestCursorRef.current,
      limit: tailLimit,
    }

    const timeout = setTimeout(() => {
      pendingRequestsRef.current.delete(requestId)
      if (requestEpoch === requestEpochRef.current && activeAgentIdRef.current === agentId) {
        historyTimeoutRef.current = null
        setIsLoadingHistory(false)
      }
    }, 10000)
    historyTimeoutRef.current = timeout

    pendingRequestsRef.current.set(requestId, (msg) => {
      clearTimeout(timeout)
      if (historyTimeoutRef.current === timeout) {
        historyTimeoutRef.current = null
      }
      if (requestEpoch !== requestEpochRef.current || activeAgentIdRef.current !== agentId) {
        return
      }

      const resp = msg as FetchTimelineResponse
      const newItems = resp.rows.map((r) => r.item)
      setItems((prev) => {
        const ids = new Set(prev.map((i) => i.id))
        const merged = [...prev]
        for (const item of newItems) {
          if (!ids.has(item.id)) {
            merged.push(item)
            ids.add(item.id)
          }
        }
        return merged.sort((a, b) => a.timestamp - b.timestamp)
      })
      setHasOlderHistory(resp.hasOlder)
      if (resp.rows.length > 0) {
        oldestCursorRef.current = {
          epoch: resp.epoch,
          seq: resp.rows[0].seq,
        }
      }
      setIsLoadingHistory(false)
    })

    socket.send(req)
  }, [agentId, hasOlderHistory, isLoadingHistory, tailLimit, socket])

  const sendMessage = useCallback(async (text: string): Promise<SendResult> => {
    const requestId = crypto.randomUUID()
    const req: SendMessageRequest = {
      type: "send_agent_message_request",
      requestId,
      agentId,
      text,
      messageId: crypto.randomUUID(),
    }

    return new Promise<SendResult>((resolve) => {
      const timeout = setTimeout(() => {
        pendingRequestsRef.current.delete(requestId)
        resolve({ accepted: false, error: "Request timed out" })
      }, 10000)

      pendingRequestsRef.current.set(requestId, (msg) => {
        clearTimeout(timeout)
        const resp = msg as { payload: { accepted: boolean; error?: string } }
        if (resp.payload.accepted) {
          resolve({ accepted: true })
        } else {
          resolve({ accepted: false, error: resp.payload.error ?? "Message rejected" })
        }
      })

      socket.send(req)
    })
  }, [agentId, socket])

  const isWorking = useMemo(() => {
    return agentState?.status === "running"
  }, [agentState])

  return {
    items,
    agentState,
    isWorking,
    hasOlderHistory,
    isLoadingHistory,
    connectionState: socket.state,
    fetchOlderHistory,
    sendMessage,
  }
}
