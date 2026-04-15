# UI Iteration 2 — Design Plan

**Status:** Completed  
**Date:** 2026-04-15  
**Scope:** WebSocket-backed agent chat, multi-agent team activity feed, theme consolidation

---

## 1. Overview

### What This Iteration Adds

UI Iteration 1 established the design system, three-layer RunDetail structure (business / governance / operator-debug), and a static read-only ChatSession component fed by REST polling. Iteration 2 promotes the agent chat from a read-only debug artifact to a first-class interactive surface backed by the Paseo WebSocket protocol, and makes multi-agent team coordination visible to the operator.

Three user stories drive this iteration:

| Story | Priority | Summary |
|---|---|---|
| US1 | HIGH | Real-time interactive agent chat per run |
| US2 | HIGH | Team communication and coordination visibility |
| US3 | SMALL | Remove light/dark theme mixing, standardize on light |

### Acceptance Criteria

**US1 — Agent Chat Session Integration**
- [ ] The operator can open a full-page chat view for any agent in the run
- [ ] Messages, tool calls, and thinking appear in real time via WebSocket
- [ ] The operator can type and send messages to the active agent
- [ ] Full conversation history is shown, paginated via tail/before/after cursor
- [ ] Working state (agent is processing) is visually indicated
- [ ] RunDetail shows a compact chat preview with a "View full chat" link
- [ ] The chat area handles WebSocket reconnection transparently

**US2 — Team Communication Visibility**
- [ ] RunDetail shows a "Team Activity" section (collapsed by default) in the operator-debug area
- [ ] Inter-agent messages and handoffs appear as a chronological feed
- [ ] The current coordination mode (supervisor, pipeline, shared-room, committee) is displayed
- [ ] The currently active agent is highlighted
- [ ] Each handoff entry shows: from-agent, to-agent, timestamp, and brief content summary

**US3 — Theme Consolidation**
- [ ] No `isDark` / `tone === "dark"` conditionals remain in ChatSession.tsx
- [ ] No `tone` prop exists on ChatSession or EventTimeline
- [ ] The operator/debug area (dark `bg-slate-950` band) uses a light-on-dark palette via explicit classes, not via a tone prop
- [ ] All components exclusively use light-theme tokens from `index.css` or direct Tailwind slate-* classes

---

## 2. WebSocket Integration Layer

### 2.1 Architecture

The WebSocket layer is a thin React hook hierarchy. No external libraries. All types are strict.

```
[Browser]
   │
   ├── usePaseoSocket (singleton per app session, manages WS lifecycle)
   │      ├── connection state machine
   │      ├── message fan-out registry
   │      └── send() helper
   │
   └── useAgentStream (per-agent hook, subscribes via usePaseoSocket)
          ├── timeline state (StreamItem[])
          ├── agent state (AgentSnapshot | null)
          └── sendMessage() action
```

### 2.2 `usePaseoSocket` Hook

**File:** `packages/app/src/hooks/usePaseoSocket.ts`

```typescript
type SocketState = "connecting" | "handshaking" | "ready" | "reconnecting" | "error" | "closed"

interface PaseoSocketOptions {
  url?: string            // default: ws://127.0.0.1:6767/ws
  clientId?: string       // stable per-browser-session UUID
  reconnectDelayMs?: number  // default: 2000, doubles on each failure, cap 30000
}

interface PaseoSocketHandle {
  state: SocketState
  sessionId: string | null
  daemonVersion: string | null
  send: (msg: WsClientMessage) => void
  addListener: (type: string, handler: (msg: WsServerMessage) => void) => () => void
}

function usePaseoSocket(options?: PaseoSocketOptions): PaseoSocketHandle
```

**State machine:**

```
CONNECTING → (ws open) → HANDSHAKING → (ws_welcome received) → READY
READY → (ws close / error) → RECONNECTING → CONNECTING
RECONNECTING → (max retries exceeded) → ERROR
any state → (manual close) → CLOSED
```

**Connection lifecycle:**
1. On mount: open `new WebSocket(url)` and set state to `connecting`
2. `onopen`: send `ws_hello` with generated `requestId`, `clientId` (from `sessionStorage`), `version: "1"`, `timestamp`
3. `onmessage`: if `ws_welcome`, extract `sessionId`, `daemonVersion`, `capabilities`, set state to `ready`
4. All subsequent messages fan out to registered listeners by `msg.type`
5. `onclose / onerror`: set state to `reconnecting`, schedule reconnect with exponential backoff
6. `addListener(type, handler)`: returns unsubscribe function; called by `useAgentStream`
7. Cleanup on unmount: close socket, clear reconnect timers

**Context:** Wrap the app in a `PaseoSocketProvider` that creates one `usePaseoSocket` instance and exposes the handle via `PaseoSocketContext`. Child hooks call `usePaseoSocketContext()` instead of creating their own connections.

**File:** `packages/app/src/hooks/PaseoSocketContext.tsx`

```typescript
interface PaseoSocketContextValue extends PaseoSocketHandle {}

const PaseoSocketContext = createContext<PaseoSocketContextValue | null>(null)

export function PaseoSocketProvider({ children, options }: { children: ReactNode; options?: PaseoSocketOptions })
export function usePaseoSocketContext(): PaseoSocketContextValue
```

### 2.3 `useAgentStream` Hook

**File:** `packages/app/src/hooks/useAgentStream.ts`

```typescript
interface AgentStreamOptions {
  agentId: string
  autoFetchTimeline?: boolean   // default: true — fetch tail on mount
  tailLimit?: number            // default: 50
}

interface AgentStreamHandle {
  items: StreamItem[]
  agentState: AgentSnapshot | null
  isWorking: boolean            // agent is actively processing
  hasOlderHistory: boolean
  isLoadingHistory: boolean
  connectionState: SocketState
  fetchOlderHistory: () => void
  sendMessage: (text: string, images?: ImageAttachment[]) => Promise<SendResult>
}

function useAgentStream(options: AgentStreamOptions): AgentStreamHandle
```

**Behavior:**
1. Subscribe to `agent_state` messages, filter by `agentId`, update `agentState`
2. Subscribe to `agent_stream` messages, filter by `agentId`, append event to `items`
3. On mount (if `autoFetchTimeline`): send `fetch_agent_timeline_request` with `direction: "tail"`, `limit: tailLimit`
4. Merge timeline response rows into `items`, deduplicate by `item.id`
5. `fetchOlderHistory()`: send `fetch_agent_timeline_request` with `direction: "before"`, cursor from oldest item, set `isLoadingHistory: true`
6. `sendMessage()`: send `send_agent_message_request`, return accepted/error from `send_agent_message_response`
7. `isWorking`: true when `agentState.status === "running"` and the last item is not a user message

### 2.4 Error Handling

| Error | Behavior |
|---|---|
| WebSocket fails to connect | State → `error`, show connection error banner in chat |
| `ws_welcome` not received within 5s | Treat as failure, reconnect |
| `sendMessage` rejected | Return `{ accepted: false, error }` to caller; caller shows toast |
| Timeline fetch has no response within 10s | Set `isLoadingHistory: false`, show retry option |
| WebSocket reconnects mid-session | Re-fetch timeline tail after `ws_welcome` to fill gap |

---

## 3. Chat Session Redesign

### 3.1 Component Hierarchy

```
ChatPage (new full-page)
└── ChatSessionView                    (new, wraps interactive session)
    ├── ChatHeader                     (agent name, status, back link)
    ├── ChatMessageList                (replaces old message rendering)
    │   ├── ChatHistoryLoader          (older history button)
    │   ├── StreamItemRenderer         (routes per item kind)
    │   │   ├── UserMessageBubble
    │   │   ├── AssistantMessageBubble
    │   │   ├── ThoughtBlock
    │   │   ├── ToolCallBlock
    │   │   ├── TodoListBlock
    │   │   └── CompactionMarker
    │   └── WorkingIndicator           (animated dots while processing)
    └── ChatInputArea                  (new interactive input)
```

The old `ChatSession.tsx` is replaced entirely. The component retains its filename but its props, logic, and rendering change completely.

### 3.2 Transformed `ChatSession.tsx`

**Old props:**
```typescript
{ runId: string; sessions: SessionRecord[]; tone?: "light" | "dark" }
```

**New props:**
```typescript
interface ChatSessionProps {
  agentId: string
  compact?: boolean        // true = compact preview in RunDetail; false = full page (default)
  onExpand?: () => void    // called when user clicks "View full chat" in compact mode
}
```

The component now owns no data-fetching logic. It calls `useAgentStream({ agentId })` internally. `compact` mode shows the last 5 messages with a "View full chat" button. Full mode shows the complete scrollable conversation.

### 3.3 Message Rendering

Each `StreamItem` kind maps to a dedicated render component. All components are web-native (no React Native, no external markdown library — use a `<pre>` or simple inline-rendered text for iteration 2, markdown can follow in iteration 3).

**UserMessageBubble**
- Right-aligned bubble
- `bg-blue-50 border border-blue-200 rounded-xl rounded-br-sm p-3`
- Shows: text content, timestamp (right-aligned, `text-xs text-slate-400`)
- Image attachments: `<img>` tags below text

**AssistantMessageBubble**
- Left-aligned, no background (white on page `bg-slate-50`)
- `bg-white border border-slate-200 rounded-xl rounded-bl-sm p-3`
- Shows: text with `whitespace-pre-wrap`, timestamp

**ThoughtBlock**
- Left-aligned, muted styling
- `bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-500 italic text-sm`
- Shows spinner icon when `status === "loading"`, checkmark icon when `status === "ready"`
- Collapsed by default in compact mode; always shown in full mode

**ToolCallBlock**
- `<details>` / `<summary>` for expand/collapse
- Header: `⚡` icon + tool name + status chip (`pending` | `done` | `error`)
- Body (when expanded): args as `<pre>` formatted JSON, result as `<pre>` when available
- Pending calls show a shimmer background: `animate-pulse bg-amber-50`
- Completed calls: `bg-slate-50`

**TodoListBlock**
- Renders `items[]` as a checklist
- Checked items: `line-through text-slate-400`
- Unchecked items: `text-slate-700`
- `bg-white border border-slate-200 rounded-lg p-3`

**CompactionMarker**
- Horizontal divider with label: `— context compacted —`
- `text-xs text-slate-400 text-center py-2`

### 3.4 Scroll and Streaming Behavior

- `ChatMessageList` uses a `useRef` to the bottom sentinel
- On new item appended: if user is within 100px of bottom, auto-scroll to bottom
- If user scrolls up: stop auto-scroll (show "↓ Jump to bottom" button)
- `WorkingIndicator`: three animated dots, shown when `isWorking === true`, hidden otherwise
  - CSS animation: `@keyframes bounce` applied to three `span` elements with staggered `animation-delay`

### 3.5 Input Area

**File:** `packages/app/src/components/ChatInputArea.tsx`

```typescript
interface ChatInputAreaProps {
  agentId: string
  disabled?: boolean        // true when agent is not running or WS disconnected
  onSend: (text: string) => Promise<void>
}
```

- Auto-sizing `<textarea>`: starts at 1 row, grows to max 6 rows
  - `resize: none` via inline style, height computed by `scrollHeight`
- Send button (right side): disabled when empty or `disabled` prop
- Keyboard: `Enter` sends, `Shift+Enter` inserts newline
- Disabled state: `opacity-50 cursor-not-allowed bg-slate-100`
- Connection banner above input when `connectionState !== "ready"`:
  - `bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-1.5 rounded-lg`
  - Text: "Reconnecting…" | "Connection error — messages cannot be sent"

### 3.6 Full-Page Chat View

**File:** `packages/app/src/pages/ChatPage.tsx`

Route: `/runs/:runId/agents/:agentId/chat`

```typescript
interface ChatPageParams {
  runId: string
  agentId: string
}
```

Layout:
```
┌─────────────────────────────────────┐
│ ChatHeader (agent name, status, ←back) │
├─────────────────────────────────────┤
│                                     │
│ ChatMessageList (flex-1, overflow-y-auto) │
│                                     │
├─────────────────────────────────────┤
│ ChatInputArea                       │
└─────────────────────────────────────┘
```

Full page uses `flex flex-col h-full` layout. The message list grows to fill available height. No sidebar.

---

## 4. Team Activity Feed

### 4.1 Data Model

The team activity feed is derived from two sources:
1. `run.resolved_team` (already in `RunRecord`) — static team structure
2. `agent_state` WebSocket messages — which agents are running and their status

Inter-agent "handoff" events are inferred from `agent_stream` events whose `kind === "user_message"` and which originate from a different agent (i.e., the `agentId` in the stream message differs from the current agent's `role_id`). This is an assumption; the actual protocol may surface dedicated handoff events. If so, handle them as `kind === "handoff"` in a future iteration.

**TeamActivity data shape:**
```typescript
interface TeamAgent {
  id: string
  name: string
  roleId: string
  status: "idle" | "running" | "done" | "error"
  lastActiveAt?: string
}

interface TeamHandoff {
  id: string
  fromAgentId: string
  toAgentId: string
  timestamp: string
  summaryText: string   // first 120 chars of message content
}

interface TeamActivityState {
  coordinationMode: "supervisor" | "pipeline" | "shared-room" | "committee" | "unknown"
  agents: TeamAgent[]
  handoffs: TeamHandoff[]
  activeAgentId: string | null
}
```

Coordination mode is read from `run.resolved_team.coordination` if present. Fall back to `"unknown"`.

### 4.2 `useTeamActivity` Hook

**File:** `packages/app/src/hooks/useTeamActivity.ts`

```typescript
interface TeamActivityOptions {
  runId: string
  resolvedTeam: RunRecord["resolved_team"]
}

function useTeamActivity(options: TeamActivityOptions): TeamActivityState
```

- On mount: subscribe to `agent_state` for all agents in `resolvedTeam.roles[]`
- Merge `AgentSnapshot` into `TeamAgent.status`
- Accumulate handoffs from `agent_stream` events as described above
- Returns stable references — memoize `agents` and `handoffs` arrays

### 4.3 `TeamActivityFeed` Component

**File:** `packages/app/src/components/TeamActivityFeed.tsx`

```typescript
interface TeamActivityFeedProps {
  teamActivity: TeamActivityState
  onOpenAgent?: (agentId: string) => void   // navigates to ChatPage for that agent
}
```

Layout (inside RunDetail operator section, collapsed by default):

```
┌── Team Activity ─────────────────────────────────── [▾ collapse] ──┐
│  Coordination: Supervisor-led     Active: research-agent            │
│                                                                     │
│  Agents:  [research ●running] [writer ○idle] [reviewer ○idle]      │
│                                                                     │
│  Activity feed:                                                     │
│  14:32  research-agent → writer-agent   "Here is the analysis…"    │
│  14:29  supervisor → research-agent     "Start with the Q4 data…"  │
└─────────────────────────────────────────────────────────────────────┘
```

**Agent status chips:** `rounded-full px-2 py-0.5 text-xs font-medium` with color:
- running: `bg-blue-100 text-blue-700`
- idle: `bg-slate-100 text-slate-500`
- done: `bg-emerald-100 text-emerald-700`
- error: `bg-red-100 text-red-600`

Each agent chip is clickable if `onOpenAgent` is provided (navigates to full chat).

**Handoff feed entries:**
```
[timestamp]  [from-agent] → [to-agent]   [summaryText truncated to 80 chars]
```
- Max 10 entries shown, newest first
- `text-sm text-slate-700` for agent names, `text-xs text-slate-400` for timestamp

**Coordination mode badge:**
| Mode | Style |
|---|---|
| supervisor | `bg-blue-50 text-blue-700 border border-blue-200` |
| pipeline | `bg-purple-50 text-purple-700 border border-purple-200` |
| shared-room | `bg-teal-50 text-teal-700 border border-teal-200` |
| committee | `bg-orange-50 text-orange-700 border border-orange-200` |
| unknown | `bg-slate-50 text-slate-500 border border-slate-200` |

**Collapsed/expanded state:** local `useState`. Collapsed shows: coordination mode badge + active agent name only. Expanded shows full feed. Default: collapsed if `handoffs.length === 0`, expanded if handoffs present.

---

## 5. Run Detail Page Updates

### 5.1 Current Three-Section Structure

```
[header]
[Business section] (2-col: phases, blockers, inputs, outputs | governance sidebar)
[Operator/Debug section] (dark band: event timeline + chat session)
```

### 5.2 Updated Structure

```
[header]
[Business section]                     ← unchanged
[Operator/Debug section]
  ├── Team Activity Feed               ← NEW, collapsible, above timeline
  ├── Event Timeline                   ← existing, no tone prop
  └── Chat Preview                     ← replaces old ChatSession
         ├── [last 5 messages]
         └── [View full chat →] link per agent
```

**Operator section markup change:**

The dark band `bg-slate-950` remains as a visual container, but neither `EventTimeline` nor `ChatSession` receive a `tone` prop. The dark background is the section container; child components always render with light tokens on top of it.

**Chat Preview in RunDetail:**

If the run has one agent:
- Show `ChatSession` in compact mode directly

If the run has multiple agents (from `resolved_team.roles`):
- Show a tab strip: one tab per agent name
- Active tab shows that agent's `ChatSession` in compact mode
- "View full chat" link routes to `/runs/:runId/agents/:agentId/chat`

**Tab strip markup:**
```html
<div role="tablist" class="flex gap-1 border-b border-slate-700 mb-4">
  <button role="tab" aria-selected="true"
    class="px-3 py-2 text-sm font-medium text-white border-b-2 border-blue-400">
    Agent name
  </button>
  …
</div>
```

### 5.3 Navigation

Add route to `App.tsx`:
```
/runs/:runId/agents/:agentId/chat  → ChatPage
```

Breadcrumbs for `ChatPage`:
```
Runs > [run id] > [agent name] > Chat
```

---

## 6. Theme Consolidation

### 6.1 Changes to `ChatSession.tsx`

Remove:
- `tone?: "light" | "dark"` prop
- `const isDark = tone === "dark"` local variable
- All `isDark ? "..." : "..."` ternary expressions
- All `dark:` Tailwind variant classes

Replace all dark-mode class pairs with their light equivalent:
- `isDark ? "border-slate-700 bg-slate-950" : "border-slate-200 bg-slate-50"` → `border-slate-200 bg-slate-50`
- `isDark ? "text-slate-100" : "text-slate-800"` → `text-slate-800`
- `isDark ? "text-slate-400" : "text-slate-500"` → `text-slate-500`
- `isDark ? "bg-blue-950 border-blue-800" : "bg-blue-50 border-blue-200"` → `bg-blue-50 border-blue-200`
- `isDark ? "bg-amber-950/40 border-amber-800" : "bg-amber-50 border-amber-200"` → `bg-amber-50 border-amber-200`
- `isDark ? "bg-slate-900 border-slate-800" : "bg-white"` → `bg-white border-slate-200`
- Tool call `<details>` dark variants → `border-slate-200 bg-slate-50 text-slate-600`

The component renders entirely in light mode. When placed inside the dark `bg-slate-950` operator section, the light cards read as white-on-dark panels — no additional styling needed.

### 6.2 Changes to `EventTimeline.tsx`

Remove:
- `tone?: "light" | "dark"` from `EventTimelineProps`
- `const isDark = tone === "dark"` local variable  
- All `isDark ?` ternary class expressions

The no-events message currently reads `text-slate-400` (dark-friendly) — change to `text-slate-500` (light-theme standard).

### 6.3 Changes to `RunDetailPage.tsx`

Remove `tone="dark"` prop from both:
```tsx
// Before
<EventTimeline events={detail.events} showRaw={showRawEvents} tone="dark" />
<ChatSession runId={run.id} sessions={detail.sessions} tone="dark" />

// After (EventTimeline unchanged props otherwise)
<EventTimeline events={detail.events} showRaw={showRawEvents} />
// ChatSession replaced by new component, see Section 3
```

### 6.4 `index.css`

No token changes required. The existing tokens are all light-theme values. No dark-mode `@media (prefers-color-scheme: dark)` block exists, and none should be added in this iteration.

---

## 7. New TypeScript Types

**File:** `packages/app/src/types/paseo.ts`

```typescript
// ── WebSocket Protocol ───────────────────────────────────────────────

export interface WsHello {
  type: "ws_hello"
  id: string          // requestId
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
  data: string      // base64
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
```

---

## 8. Component Inventory

### New Components

| Component | File | Props | Behavior |
|---|---|---|---|
| `PaseoSocketProvider` | `hooks/PaseoSocketContext.tsx` | `children, options?: PaseoSocketOptions` | Creates one WS connection, provides handle via context |
| `ChatSessionView` | `components/ChatSessionView.tsx` | `agentId: string, compact?: boolean, onExpand?: () => void` | Full interactive chat using `useAgentStream` |
| `ChatMessageList` | `components/ChatMessageList.tsx` | `items: StreamItem[], isWorking: boolean, hasOlderHistory: boolean, isLoadingHistory: boolean, onLoadOlder: () => void` | Scrollable list with auto-scroll, older-history button |
| `StreamItemRenderer` | `components/StreamItemRenderer.tsx` | `item: StreamItem` | Routes each `StreamItem` kind to its renderer |
| `UserMessageBubble` | `components/UserMessageBubble.tsx` | `item: UserMessageItem` | Right-aligned user message |
| `AssistantMessageBubble` | `components/AssistantMessageBubble.tsx` | `item: AssistantMessageItem` | Left-aligned assistant message |
| `ThoughtBlock` | `components/ThoughtBlock.tsx` | `item: ThoughtItem` | Collapsible thought with loading/ready state |
| `ToolCallBlock` | `components/ToolCallBlock.tsx` | `item: ToolCallItem` | Expandable tool call with args + result |
| `TodoListBlock` | `components/TodoListBlock.tsx` | `item: TodoListItem` | Checklist display |
| `WorkingIndicator` | `components/WorkingIndicator.tsx` | `visible: boolean` | Animated three-dot indicator |
| `ChatInputArea` | `components/ChatInputArea.tsx` | `agentId: string, disabled?: boolean, onSend: (text: string) => Promise<void>` | Auto-sizing textarea + send button + connection banner |
| `TeamActivityFeed` | `components/TeamActivityFeed.tsx` | `teamActivity: TeamActivityState, onOpenAgent?: (agentId: string) => void` | Collapsible team coordination view |
| `ChatPage` | `pages/ChatPage.tsx` | (route params: `runId`, `agentId`) | Full-page chat layout |

### New Hooks

| Hook | File | Returns |
|---|---|---|
| `usePaseoSocket` | `hooks/usePaseoSocket.ts` | `PaseoSocketHandle` |
| `usePaseoSocketContext` | `hooks/PaseoSocketContext.tsx` | `PaseoSocketContextValue` |
| `useAgentStream` | `hooks/useAgentStream.ts` | `AgentStreamHandle` |
| `useTeamActivity` | `hooks/useTeamActivity.ts` | `TeamActivityState` |

### New Types File

| File | Content |
|---|---|
| `types/paseo.ts` | All WebSocket protocol types, StreamItem variants, AgentSnapshot (see Section 7) |

### Modified Components

| Component | File | Change |
|---|---|---|
| `ChatSession` | `components/ChatSession.tsx` | Complete rewrite: new props, calls `useAgentStream`, renders `ChatMessageList` + `ChatInputArea` in compact or full mode |
| `EventTimeline` | `components/EventTimeline.tsx` | Remove `tone` prop and all dark-mode conditional classes |
| `RunDetailPage` | `pages/RunDetailPage.tsx` | Add TeamActivityFeed, update ChatSession usage (new props), remove tone props from EventTimeline, add agent tab strip for multi-agent runs |
| `App.tsx` (router) | `App.tsx` | Add `/runs/:runId/agents/:agentId/chat` route → `ChatPage` |
| `App.tsx` (providers) | `App.tsx` | Wrap app in `PaseoSocketProvider` |

---

## 9. Priority and Sequencing

### Dependencies Map

```
paseo.ts (types)
   └── usePaseoSocket + PaseoSocketContext
          └── useAgentStream
                 ├── ChatSession (rewrite)
                 │      ├── ChatMessageList
                 │      │     └── StreamItemRenderer (+ 5 bubble/block components)
                 │      └── ChatInputArea
                 ├── ChatPage
                 └── useTeamActivity
                        └── TeamActivityFeed

WorkingIndicator (no deps)
EventTimeline theme fix (no deps)
ChatSession theme fix (bundled with rewrite)
RunDetailPage updates (depends on all above)
Router update (depends on ChatPage)
```

### Phase 1 — Foundation (no visible UI change)

Build the invisible plumbing first. These can be verified by checking WebSocket traffic in browser devtools.

1. Write `packages/app/src/types/paseo.ts` — all TypeScript interfaces
2. Write `usePaseoSocket` hook + `PaseoSocketProvider` / `PaseoSocketContext`
3. Write `useAgentStream` hook
4. Wrap `App.tsx` in `PaseoSocketProvider`
5. Write `useTeamActivity` hook

**Acceptance check for Phase 1:** Console-log `usePaseoSocket` state transitions and `useAgentStream` items when navigating to a RunDetail page. WebSocket handshake should complete and stream items should arrive.

### Phase 2 — Theme Consolidation (US3)

Simple, independent, delivers visible cleanup.

1. Remove `tone` prop from `EventTimeline`, clean all `isDark` conditions
2. Remove `tone` prop pass-through in `RunDetailPage`
3. Remove dark-mode conditionals from old `ChatSession` (even though it will be replaced — makes Phase 3 diff cleaner)

**Acceptance check:** Run detail page operator section renders cleanly; no dark card rendering inconsistencies.

### Phase 3 — Interactive Chat (US1)

Replace ChatSession and add ChatPage.

1. Write leaf components: `WorkingIndicator`, `UserMessageBubble`, `AssistantMessageBubble`, `ThoughtBlock`, `ToolCallBlock`, `TodoListBlock`, `CompactionMarker`
2. Write `StreamItemRenderer`
3. Write `ChatMessageList` (scroll behavior, history loader)
4. Write `ChatInputArea` (textarea, send, connection banner)
5. Rewrite `ChatSession.tsx` with new props + `useAgentStream`
6. Write `ChatPage` (full-page layout)
7. Add route in `App.tsx`
8. Update `RunDetailPage` to use new `ChatSession` props (remove `sessions` prop, add `agentId`)

**Acceptance check:** 
- Navigate to a run. Compact chat preview shows real messages.
- Click "View full chat" → navigates to `/runs/:runId/agents/:agentId/chat`.
- Type a message, press Enter → message appears in thread. Agent response streams in.
- Scroll up → history loads via `fetchOlderHistory`.
- Disconnect network → connection banner appears. Reconnect → banner disappears.

### Phase 4 — Team Activity (US2)

1. Write `TeamActivityFeed` component
2. Add `TeamActivityFeed` to `RunDetailPage` operator section (above EventTimeline)
3. Wire agent chip clicks to `onOpenAgent` → navigate to ChatPage

**Acceptance check:**
- Run with a multi-agent team shows the Team Activity section.
- Agents listed with correct status chips (running/idle).
- Coordination mode badge shows correct label.
- Clicking an agent chip navigates to that agent's full chat view.

### Rollback Boundary

Phase 1 and Phase 2 are fully independent. Phase 3 can be reverted by restoring the old `ChatSession` props contract and adding back `sessions` to `RunDetailResponse`. Phase 4 is purely additive.

---

## Appendix: Assumptions

1. **Assumption A:** The Paseo WebSocket at `ws://127.0.0.1:6767/ws` is reachable from the browser. The UI will fail gracefully to `error` state if it is not.
2. **Assumption B:** `agent_stream` events include `agentId` that matches the agent's `id` from `AgentSnapshot`. If the field name differs, update the filter in `useAgentStream`.
3. **Assumption C:** There is no dedicated handoff event type in the current protocol. Inter-agent communication is inferred from user_message items in one agent's stream that reference another agent. If the protocol is extended to include a `handoff` kind, add it to `StreamItem` and update `TeamActivityFeed`.
4. **Assumption D:** `run.resolved_team.roles` is an array of agent role IDs, each of which corresponds to an `agentId` for WebSocket subscription. If the shape differs, update `useTeamActivity` initialization.
5. **Assumption E:** Paseo reference components in `.local/refCode/` are React Native components and are not directly usable in the web app. UI patterns are adapted conceptually; no code is ported directly.
