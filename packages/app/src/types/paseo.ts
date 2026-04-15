// ── WebSocket Protocol ───────────────────────────────────────────────

export interface WsHello {
  type: "ws_hello"
  id: string
  clientId: string
  version: string
  timestamp: number
}

export interface WsWelcome {
  type: "ws_welcome"
  clientId: string
  daemonVersion: string
  sessionId: string
  capabilities: string[]
}

export interface AgentStateMessage {
  type: "agent_state"
  agent: AgentSnapshot
}

export interface AgentStreamMessage {
  type: "agent_stream"
  agentId: string
  event: AgentStreamEvent
}

export interface SendMessageRequest {
  type: "send_agent_message_request"
  requestId: string
  agentId: string
  text: string
  messageId?: string
  images?: ImageAttachment[]
}

export interface SendMessageResponse {
  type: "send_agent_message_response"
  payload: {
    requestId: string
    agentId: string
    accepted: boolean
    error?: string
  }
}

export interface FetchTimelineRequest {
  type: "fetch_agent_timeline_request"
  agentId: string
  requestId: string
  direction: "tail" | "before" | "after"
  cursor?: TimelineCursor
  limit?: number
}

export interface FetchTimelineResponse {
  type: "fetch_agent_timeline_response"
  requestId: string
  epoch: number
  rows: TimelineRow[]
  hasOlder: boolean
  hasNewer: boolean
  gap: boolean
}

export type WsClientMessage = WsHello | SendMessageRequest | FetchTimelineRequest
export type WsServerMessage = WsWelcome | AgentStateMessage | AgentStreamMessage | SendMessageResponse | FetchTimelineResponse

// ── Agent Snapshot ───────────────────────────────────────────────────

export interface AgentSnapshot {
  id: string
  status: "idle" | "running" | "done" | "error" | "waiting"
  roleId?: string
  name?: string
  modelId?: string
  startedAt?: number
  updatedAt?: number
}

// ── Timeline ─────────────────────────────────────────────────────────

export interface TimelineCursor {
  epoch: number
  seq: number
}

export interface TimelineRow {
  seq: number
  timestamp: number
  item: StreamItem
}

// ── Stream Items ─────────────────────────────────────────────────────

export interface UserMessageItem {
  kind: "user_message"
  id: string
  text: string
  timestamp: number
  images?: ImageAttachment[]
}

export interface AssistantMessageItem {
  kind: "assistant_message"
  id: string
  text: string
  timestamp: number
}

export interface ThoughtItem {
  kind: "thought"
  id: string
  text: string
  timestamp: number
  status: "loading" | "ready"
}

export interface ToolCallItem {
  kind: "tool_call"
  id: string
  timestamp: number
  payload: ToolCallPayload
}

export interface TodoListItem {
  kind: "todo_list"
  id: string
  timestamp: number
  items: TodoEntry[]
}

export interface ActivityLogItem {
  kind: "activity_log"
  id: string
  timestamp: number
  level: "info" | "warn" | "error"
  message: string
}

export interface CompactionItem {
  kind: "compaction"
  id: string
  timestamp: number
}

export type StreamItem =
  | UserMessageItem
  | AssistantMessageItem
  | ThoughtItem
  | ToolCallItem
  | TodoListItem
  | ActivityLogItem
  | CompactionItem

// ── Supporting Types ─────────────────────────────────────────────────

export interface ImageAttachment {
  data: string
  mimeType: string
}

export interface ToolCallPayload {
  toolName: string
  args?: Record<string, unknown>
  result?: unknown
  status: "pending" | "done" | "error"
  error?: string
}

export interface TodoEntry {
  id: string
  text: string
  done: boolean
}

export interface AgentStreamEvent {
  item: StreamItem
}

export type SendResult =
  | { accepted: true }
  | { accepted: false; error: string }
