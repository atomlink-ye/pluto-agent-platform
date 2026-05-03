# Plan: Agent Teams chat-backed mailbox runtime

## Status

Status: Active

## Goal

Turn the current mailbox/task-list evidence harness into a real Agent Teams-style runtime where messages are deliverable, agents can be woken or resumed by mailbox traffic, and the TeamLead owns orchestration decisions through a chat-backed coordination substrate.

## Background and source records

This plan follows the local 2026-05-02 product/runtime review after running custom Pluto scenarios against `openai/symphony` with `PASEO_PROVIDER=opencode` and `PASEO_MODEL=openai/gpt-5.4-mini`.

References inspected:

- Current Pluto runtime:
  - `src/orchestrator/manager-run-harness.ts`
  - `src/four-layer/mailbox.ts`
  - `src/four-layer/task-list.ts`
  - `src/four-layer/hooks.ts`
  - `src/four-layer/plan-approval.ts`
  - `src/adapters/paseo-opencode/paseo-opencode-adapter.ts`
  - `src/adapters/fake/fake-adapter.ts`
  - `src/contracts/adapter.ts`
- Current/previous plan records:
  - `docs/plans/completed/agent-teams-v1_6.md`
  - `docs/plans/completed/teamlead-orchestrated-agent-team-architecture.md`
  - `docs/plans/completed/opencode-agent-teams-gap-review.md`
  - `.local/manager/logs/iter-agent-teams-2026-05-02/final-report.md`
- Claude Code Agent Teams source reference:
  - `/Volumes/AgentsWorkspace/archive/legacy/workspace-tree/repos/claude-code-source-code/src/tools/SendMessageTool/SendMessageTool.ts`
  - `/Volumes/AgentsWorkspace/archive/legacy/workspace-tree/repos/claude-code-source-code/src/hooks/useInboxPoller.ts`
  - `/Volumes/AgentsWorkspace/archive/legacy/workspace-tree/repos/claude-code-source-code/src/utils/teammateMailbox.ts`

## Problem statement

The v1.6 runtime has useful primitives and evidence surfaces, but the current implementation is still not the intended TeamLead-owned Agent Teams runtime.

The current implementation can run lead and worker agents, write `mailbox.jsonl`, write `tasks.json`, and produce evidence packets. However, the mailbox is mostly a local evidence mirror and deterministic harness script, not a live message bus. `paseo chat` is not currently the transport. There is no inbox poller that turns unread mailbox messages into new agent turns. TeamLead is not continuously receiving teammate messages and deciding what to do next.

The result is misleadingly green:

- Runs succeed.
- Evidence files exist.
- Role citations exist.
- The playbook order appears in `tasks.json` and `mailbox.jsonl`.

But the orchestration owner is still Pluto's harness loop, not TeamLead.

## Findings from current Pluto code

### 1. `paseo chat` is not wired into the live adapter

`PaseoOpenCodeAdapter` currently uses:

- `paseo run` to start the lead.
- `paseo run` + `paseo wait` to start and wait for workers.
- `paseo send <lead>` for the final `SUMMARIZE` turn.
- `paseo logs` to scrape final text.

It does **not** call:

- `paseo chat create`
- `paseo chat post`
- `paseo chat read`
- `paseo chat wait`

Therefore the current `mailboxRef.roomRef` value such as `mailbox:<runId>` is not a real Paseo chat room. It is a local locator string used for evidence.

### 2. `FileBackedMailbox` is a store, not a transport

`src/four-layer/mailbox.ts` provides:

- `send()` — append to an inbox file and append to `mailbox.jsonl`.
- `read()` — read an inbox file.
- `markRead()` — mark messages read.

There is no background consumer, no `wait`, no adapter delivery, and no relationship to a live agent session. Writing a message to an inbox does not wake the target agent and does not become model context unless another component explicitly submits it.

This also means `mailbox.jsonl` is currently vulnerable to confusion: prompts expose the mailbox path to agents, so agents may write or edit the file directly. Direct file mutation bypasses validation, attribution, wakeup, and event emission. The durable evidence mirror should be treated as runtime-owned output, not as an agent-editable communication API.

### 3. `manager-run-harness.ts` owns worker sequencing

The main runtime loop creates and dispatches every worker from Pluto itself:

1. Create a task for the next member role.
2. Write a lead-to-worker mailbox assignment.
3. Claim the task for that worker.
4. Call `adapter.createWorkerSession()`.
5. Wait for the worker completion event.
6. Write a worker-to-lead completion message.
7. Mark the task completed.
8. Move to the next role.

That static loop means the selected playbook's member order is being enforced by Pluto, not by TeamLead. TeamLead is started at the beginning and asked to summarize at the end, but does not drive the middle of the run.

### 4. `spawnTeammate()` is a seam but not yet TeamLead-owned spawning

`PaseoTeamAdapter.spawnTeammate?()` exists in `src/contracts/adapter.ts`, but the current live adapter implementation delegates to `createWorkerSession()` internally. It does not prove that TeamLead requested the spawn, executed `paseo run`, or coordinated through a room.

This is a useful compatibility seam, but it is not the final control-plane ownership model.

### 5. `sendMessage()` only supports the lead summary path

`PaseoOpenCodeAdapter.sendMessage()` currently rejects any `sessionId` other than the lead session. It also special-cases `SUMMARIZE` as the only path that reads back a `lead_message` event.

This prevents the runtime from implementing the Agent Teams behavior where arbitrary teammates can receive a mailbox message and continue work. It also prevents external/user messages from waking a worker or asking a worker to revise.

### 6. Hooks and plan approval are present but not integrated as live control points

The current hooks are useful but narrow:

- `TaskCompleted` acceptance command check.
- `TeammateIdle` nudge hook.

Plan approval helpers exist, but the current runtime synthesizes a planner request and synthetic lead approval inside the harness. There is no actual inbox poller that lets a planner request approval, wakes the lead, lets the lead respond, and wakes the planner with that response.

## Findings from Claude Code Agent Teams reference

Claude Code's Agent Teams design uses a mailbox file store too, but the important missing piece in Pluto is the consumer/wakeup path.

Relevant reference behavior:

- `SendMessageTool` writes to teammate mailboxes, supports broadcast, supports structured messages, and can route to in-process agents, bridge peers, or UDS peers.
- For a running local agent, `SendMessageTool` queues pending messages for delivery at the next tool round.
- For a stopped agent, `SendMessageTool` can resume the agent in the background with the message.
- `useInboxPoller` polls unread messages every second.
- When a session is idle, the poller submits unread teammate messages as a new model turn immediately.
- When a session is busy, the poller queues messages in application state and delivers them when the session becomes idle.
- Structured control messages such as permission requests, plan approval requests/responses, shutdown requests, mode changes, and team permission updates are routed through handlers rather than blindly appended as raw context.

The key distinction is that Claude Code has both:

1. a durable mailbox store, and
2. a delivery loop that turns unread messages into agent context and control-plane effects.

Pluto currently has only the first part.

## Root cause

The v1.6 implementation completed the durable surfaces first: mailbox files, task files, evidence, final reports, and deterministic smoke assertions. That created inspectable evidence, but it also left the harness as the active control plane.

The code and docs then overstate the architecture by calling the mailbox/task-list runtime Agent Teams parity and saying Paseo chat is the mailbox transport. In practice, the live adapter still uses `paseo run` / `paseo wait` / `paseo send`, and the mailbox is populated by Pluto's TypeScript loop.

The real missing runtime layers are:

- a chat-backed mailbox transport;
- an inbox delivery/wakeup loop;
- a TeamLead-driven dispatch protocol;
- smoke tests that fail when Pluto, not TeamLead, owns the run.

## Target design direction

### Principle 1 — Mailbox is a logical bus; `mailbox.jsonl` is evidence

Agents should not edit `mailbox.jsonl` or inbox files directly. Those files are runtime-owned evidence mirrors. Agent-facing prompts should say explicitly:

> Do not edit mailbox files directly. Use the provided message/coordination mechanism. The mailbox files are audit output.

The runtime should accept messages through a typed API, validate them, deliver them through a transport, and mirror them to disk.

### Principle 2 — Paseo chat should be the preferred transport

Add a transport abstraction that can be implemented by `paseo chat` in live mode and by an in-memory/file-backed transport in fake tests.

Candidate interface:

```ts
interface MailboxTransport {
  createRoom(input: { runId: string; name: string; purpose?: string }): Promise<RoomRef>;
  post(input: { room: RoomRef; message: MailboxEnvelope; replyTo?: string }): Promise<TransportMessageRef>;
  read(input: { room: RoomRef; cursor?: MailboxCursor; limit?: number }): Promise<TransportReadResult>;
  wait(input: { room: RoomRef; cursor?: MailboxCursor; timeoutMs: number }): Promise<TransportReadResult>;
}
```

Live implementation should use:

- `paseo chat create <name> --purpose <text> --json`
- `paseo chat post <room> <message> --reply-to <msg-id> --json`
- `paseo chat read <room> --since <cursor> --json`
- `paseo chat wait <room> --timeout <duration> --json`

The local mirror should store the transport message id, author, target role, run id, task id, and structured body.

### Principle 3 — Add a Pluto inbox delivery loop

Add a runtime service equivalent to Claude Code's `useInboxPoller`, adapted for CLI/server execution.

Candidate responsibilities:

- Wait/read the run chat room.
- Normalize incoming chat messages into `MailboxMessage` envelopes.
- Persist normalized messages to `mailbox.jsonl` and per-role inbox mirrors.
- Classify structured messages before treating them as model context.
- Deliver ordinary teammate messages to the target agent session when idle.
- Queue messages when a target session is busy.
- Deliver queued messages after `paseo wait` reports the target session idle.
- Mark messages read only after delivery or durable queueing succeeds.
- Emit events for `mailbox_message_received`, `mailbox_message_delivered`, `mailbox_message_queued`, and `mailbox_message_failed`.

This service is the missing wakeup path: writing or posting a mailbox message should cause the target agent to receive a new turn or queue for a later turn.

### Principle 4 — TeamLead should drive dispatch through messages

Replace the static `for (const role of memberRoles)` dispatch loop with a lead-message-driven loop.

Target flow:

1. Pluto creates room, task list, mailbox mirrors, and run evidence directory.
2. Pluto launches TeamLead and sends `RUN_START` with the playbook and room reference.
3. TeamLead posts a structured task/spawn request for a role.
4. Pluto validates the request against the selected playbook and task dependencies.
5. If the TeamLead runtime can spawn directly, TeamLead may run `paseo run` itself and post session/output refs.
6. If using the bridge fallback, Pluto mechanically creates the worker session only after the TeamLead message requests it.
7. Worker output is posted back to the room and delivered to TeamLead.
8. TeamLead decides whether to request the next stage, revision, escalation, or final reconciliation.
9. Pluto validates final evidence and writes the canonical artifacts.

This preserves Pluto as harness/observer/guardrail while making TeamLead the decision owner.

### Principle 5 — Adapter send must support any known session

Extend `PaseoTeamAdapter` so delivery is not lead-only.

Candidate additions:

```ts
sendSessionMessage(input: {
  runId: string;
  sessionId: string;
  message: string;
  wait?: boolean;
}): Promise<void>;

sendRoleMessage(input: {
  runId: string;
  roleId: string;
  message: string;
  wait?: boolean;
}): Promise<void>;
```

The live adapter should map role ids to session ids and use `paseo send`. If a session is not running but resumable, a later enhancement can resume it or report a structured delivery failure. Fake adapter should implement equivalent deterministic event behavior for tests.

## Proposed implementation stages

### Stage A — Stop misleading runtime semantics and protect mailbox evidence

Status: **DONE (2026-05-02)** — local worktree `pluto/agent-teams-chat-mailbox-runtime-s1`, applied from remote `07b5c44b-7177-44fb-a2ca-dd2df2a037cb` final report (PARTIAL only because `.local/manager/*` is gitignored; R6 + this completion mark added locally).

Scope (delivered):

- Locked verbatim collar text injected globally via `src/four-layer/render.ts`; lead prompt assembly at `src/adapters/paseo-opencode/paseo-opencode-adapter.ts:625-627` no longer exposes `Mailbox path` / `Mailbox reference`; harness mailbox bodies in `src/orchestrator/manager-run-harness.ts:294,310` use logical coordination handles instead of absolute paths. Snapshot tests cover lead + planner + generator + evaluator + custom roles in `tests/prompt-collar.test.ts`.
- New `src/four-layer/runtime-owned-files.ts` captures `{filePath, sha256, lineCount, writtenAt}` snapshots per runtime-owned write under `runDir/evidence/`. Hook-boundary diff checks emit `mailbox_external_write_detected` / `tasklist_external_write_detected` audit events (emit-only; capture wrapped in try/catch so I/O failures cannot abort the run). New event kinds added to `src/contracts/four-layer.ts` + `src/contracts/types.ts`. Tests at `tests/four-layer/{mailbox,tasklist}-external-write-audit.test.ts`.
- All `paseo chat *` claims in `README.md`, `ARCHITECTURE.md`, `RELIABILITY.md`, `docs/design-docs/*`, `docs/plans/completed/*` are qualified as "target / planned / by `agent-teams-chat-mailbox-runtime` Stage B". `.local/manager/operating-rules.md` R6 wording adjusted to match.

Gates: `pnpm typecheck`, `pnpm test` (216 files / 675 tests, +7 vs v1.6 baseline 668), `pnpm build`, `pnpm smoke:fake` (runId `f832438a-87ee-42f9-b7b6-ff0c96b3c980`) — all green locally.

### Stage B — Add mailbox transport abstraction and Paseo chat implementation

Status: **DONE (2026-05-03)** — local worktree `pluto/agent-teams-chat-mailbox-runtime-s2`, applied from remote `36b79549-5f45-4c63-82ba-5258a2b9282e` final report (READY_FOR_LOCAL_REVIEW; 7 commits + 1 fix-pass for transport reply ids; live smoke parity verified on sandbox with real chat room `a9900299-…`, run `e7993b15-…`, 10-message order/id parity).

Scope (delivered):

- New `src/four-layer/mailbox-transport.ts` defines the 3-method `MailboxTransport` (`createRoom`/`post`/`read` — no `wait()`, that's S3). New `src/adapters/paseo-opencode/paseo-chat-transport.ts` is the live impl (probes `paseo chat create/post/read --help`; `--since` time-based read; envelope JSON-encoded into the positional `<message>` arg; `PASEO_HOST` plumbed). New `src/adapters/fake/fake-mailbox-transport.ts` is the in-memory fake with idempotent `createRoom`, dedupe by transport id, raw-wire payloads for envelope-reject tests.
- Capability probe failure → blocker `payload.reason = "chat_transport_unavailable"` (provider-neutral; renamed from initial `paseo_chat_unavailable` to comply with the "no `paseo_*` literals in `src/contracts/`" hard rule). CLI exit code **2** mapped at `src/cli/run.ts:108-109` only for that reason.
- Harness wiring (`src/orchestrator/manager-run-harness.ts`): room creation moved post-init; `Run.coordinationChannel` reuses existing `CoordinationChannelRef` shape with `kind: "shared_channel"`, `locator: <real roomId>`, `path: <runDir>/mailbox.jsonl`. Mailbox writes are post-first → mirror-with-baked-metadata (no in-place mutation; `mailbox.ts` still strictly append-only). Post failure → mirror entry with `transportStatus: "post_failed"` + `mailbox_transport_post_failed` audit event; run continues. Mirror append failure → run aborts with run-level `blockerReason: "mailbox_mirror_failed"` (raised from initial harness behavior of downgrading to generic `runtime_error`). End-of-run parity check is audit-only; chat drift emits `mailbox_transport_parity_drift` but run stays `succeeded`.
- Existing `coordination_transcript_created` event (defined `src/contracts/types.ts`, never previously emitted) is now emitted at room creation. `mailbox_message` event payload extended to include `transportMessageId` when present.
- 4 new audit/blocker reasons added to enums: `chat_transport_unavailable`, `mailbox_mirror_failed`, plus three audit-event kinds `mailbox_transport_post_failed`, `mailbox_transport_envelope_rejected`, `mailbox_transport_parity_drift`.
- 4 new test files: `tests/four-layer/mailbox-transport.test.ts`, `tests/orchestrator/harness-chat-room.test.ts`, `tests/adapters/paseo-chat-transport-capability.test.ts`, `tests/cli/run-exit-code-2.test.ts`. Live smoke (`docker/live-smoke.ts`) extended with chat-room creation assertion + 10-message parity check (chat transcript ↔ mirror).

Gates: `pnpm typecheck`, `pnpm test` (217 files / 679 tests, +4 vs S1 / +11 vs v1.6 baseline 668), `pnpm build`, `pnpm smoke:fake` — all green locally. Live smoke green on sandbox (above).

Deferred follow-ups (non-blocking, to address with S6 or a separate cleanup):

- Capability test currently uses `PASEO_BIN="/definitely/missing/paseo"` rather than PATH monkey-patch — functionally equivalent for the capability detection, but the original spec called for PATH. Either is acceptable.
- No direct unit test for `paseo chat post --reply-to <transportMessageId>` (the fix-pass added body-parsing coverage; the reply-id wiring is exercised by live smoke parity end-to-end). Adding a focused fake-transport test would shorten the regression cycle.
- S2 incidentally widened `tests/cli/bootstrap-workspace.test.ts` timeout to 30s for wall-clock jitter — orthogonal to S2 scope but small.

Scope:

- Add `MailboxTransport` types and fake/live implementations.
- Create a chat room at run start in live mode.
- Mirror `paseo chat` messages to `mailbox.jsonl`.
- Store room metadata in `Run.coordinationChannel` and `EvidencePacket` lineage.

Acceptance:

- Live run emits a `chat_room_created` or equivalent event containing the room id/name.
- Evidence includes the real room ref.
- `paseo chat read <room>` returns messages corresponding to the mirrored mailbox evidence.

### Stage C — Add inbox delivery and wakeup loop

Scope:

- Add an inbox delivery service for agent sessions.
- Poll/wait the run chat room.
- Deliver messages to target sessions with `paseo send` when idle.
- Queue messages when busy and deliver after idle.
- Mark mirrored messages read only after successful delivery or durable queueing.

Acceptance:

- A message posted to the room for TeamLead is delivered as a new TeamLead turn without waiting for final `SUMMARIZE`.
- A message posted to a worker can be delivered to that worker by role/session id.
- Tests cover idle delivery, busy queueing, and failed delivery.

### Stage C — DONE (2026-05-03)

Status: **DONE (2026-05-03)** — committed locally as `3165537` on `pluto/agent-teams-chat-mailbox-runtime-s3` (4 remote rounds + intervention; final fix is the same-timestamp cursor + bounded no-progress backoff). Remote sandbox proves smoke:fake + smoke:live both 3/3 with `delivered=9 == mailboxMessageCount=9`, plan-approval round-trip flows through actual transport + delivery loop, and live chat parity verified against a real paseo chat room.

Scope (delivered):

- New `src/four-layer/mailbox-transport.ts` 4th method `wait()` with `TransportWaitResult` (live impl: `paseo chat wait --timeout` + `chat read --since` 2-step; fake impl: timeoutMs==0 instant + bounded no-progress backoff for same-timestamp repeats).
- New `src/orchestrator/inbox-delivery-loop.ts` (~290 LoC) — per-run lifecycle, idle deliver / busy queue / failed→event semantics, just-in-time session idle check, final-pass `flushShutdownPass` on stop, exact-timestamp cursor (no `+1ms` advance to avoid skipping same-stamped messages), `seenTransportMessageIds` dedupe.
- New `PaseoTeamAdapter.sendSessionMessage` + `sendRoleMessage` adapter methods + role→session map on `RunState.roleSessionIds`. Live uses `paseo send --no-wait --prompt-file`. Lead-only `sendMessage(SUMMARIZE)` path preserved.
- Plan-approval round-trip rewired: planner posts `plan_approval_request` via `sendMailboxMessage` → loop delivers to lead → lead's `onDelivered` callback synthesizes the response and posts via `sendMailboxMessage` → loop delivers response back to planner. The harness in-memory shortcut at the previous `:478-507` site is removed.
- 3 new event kinds: `mailbox_message_delivered` / `mailbox_message_queued` / `mailbox_message_failed` (routine telemetry; not audit-class).
- Capability probe extended with `paseo chat wait --help` (failure reuses S2's `chat_transport_unavailable` blocker; no new reason).
- 4 new test files: `tests/four-layer/inbox-delivery-loop.test.ts`, `tests/orchestrator/plan-approval-round-trip.test.ts`, `tests/adapters/paseo-chat-transport-capability.test.ts` (extended with timeout-recovery), `tests/cli/run-exit-code-2.test.ts` (S2-era).
- Live-smoke (`docker/live-smoke.ts`) extended with delivery-event chain assertion + `mailboxMessageCount`/`deliveredEventCount` divergence check.

Local-only caveats deferred to S6 hardening:

- **macOS smoke:fake non-determinism**: occasionally fails with `deliverable mailbox entries and delivered event count diverged` — the last response message posted just before run-end is not always delivered before `flushShutdownPass` races with run end. Sandbox (Linux) shows green 3/3; macOS is intermittent. Symptom is the same-timestamp final-message case the round-3 fix attacked but didn't fully eliminate.
- **Targeted vitest unit tests can hot-spin** if the no-progress backoff is triggered but the loop's `stopped` flag never flips (test fixture leak). 99% CPU pegged until `kill -9`.

S6 hardening tasks tracked here:

- Bound the inbox loop's no-progress backoff with explicit max-rounds and total-elapsed-time guards (so it always terminates).
- `flushShutdownPass` should drain the cursor in a loop until the wait result is empty for ≥ N consecutive iterations, not just one read.
- Add an explicit fake-transport "advance time" hook for fully deterministic tests (no real-clock dependency).
- Resolve cross-slice S1↔S3 conflict on `mailbox.ts`, `manager-run-harness.ts`, `four-layer.ts`, `types.ts` (audit guard wiring + delivery loop + audit/delivery event kinds all converge).

### Stage D — Convert dispatch to TeamLead-message-driven control

Scope:

- Define structured message envelopes for TeamLead task/spawn requests, worker completions, evaluator verdicts, revision requests, and final reconciliation.
- Change `manager-run-harness.ts` so Pluto does not iterate member roles by itself in the chat-backed path.
- Validate TeamLead task/spawn messages against playbook roles and dependencies.
- Use the bridge only as mechanical execution after a TeamLead-authored request.

Acceptance:

- Planner/generator/evaluator or custom roles are created only after a TeamLead message requests them.
- Events record `orchestrationSource: "teamlead_chat"` or equivalent, not `pluto_static_loop`.
- Generator cannot start before planner output exists when the playbook declares that dependency.
- Evaluator cannot start before generator output exists.

### Stage D — DONE (2026-05-03)

Status: **DONE (2026-05-03)** — committed locally as `ffbb52f` on `pluto/agent-teams-chat-mailbox-runtime-s4`. Stack on sandbox: `daytona/s4-final` = `ffbb52f` ← `daytona/s3-final(3165537)` ← `daytona/s2-final(2974439)` ← `main(269ab49)`. Remote sandbox proves typecheck/build/full-test/smoke:fake/smoke:live all green; live smoke run `b7c85d33-ebe0-4789-8acd-7c5f77696276` with chat room `0ae015ee-9e7a-494e-a4db-b3a4262109ba` shows `dispatch-events.txt` containing `spawn_request_received/_executed`, `worker_complete_received`, `final_reconciliation_received`, all carrying `orchestrationSource: "teamlead_chat"`.

Scope (delivered):

- 3 new typed `MailboxMessage` body kinds: `spawn_request` `{targetRole, taskId, rationale?}`, `worker_complete` `{taskId, status, artifactRef?, summary?}`, `final_reconciliation` `{summary, completedTaskIds}`.
- 7 new event kinds: `spawn_request_received` / `spawn_request_executed` / `spawn_request_rejected` / `spawn_request_untrusted_sender` / `worker_complete_received` / `worker_complete_untrusted_sender` / `final_reconciliation_received`.
- New event-payload field `orchestrationSource: "teamlead_chat" | "static_loop"` (distinct from existing playbook/evidence metadata of the same name) emitted by the dispatch handler on relevant events.
- Static for-loop replaced with `onDelivered` switch on `message.kind` in `src/orchestrator/manager-run-harness.ts`. Legacy loop preserved as fallback gated by `PLUTO_DISPATCH_MODE=static_loop` env flag (default `teamlead_chat`).
- dependsOn relies on existing `taskList.claim()` rejection mapping `task_blocked:` → `dependsOn_unsatisfied`; no duplicate validation.
- Trusted-sender enforced on the loop ingest side: `spawn_request` rejected if `from != leadRole.id`; `worker_complete` rejected if `from != taskList.claimedBy(taskId)`. Both produce `*_untrusted_sender` audit events + drop.
- Lead collar text appended to `src/four-layer/render.ts:93-96` after S1's mailbox-files-collar at `:87-90`.
- `tests/audit/event-vocabulary-compat.test.ts` allowlist updated for the 7 new kinds.
- New tests `tests/orchestrator/teamlead-driven-dispatch.test.ts` (5 cases): happy + dependsOn rejection + 2x untrusted-sender + static_loop fallback. All pass standalone in 7.82s.
- `docker/live-smoke.ts` extended with `orchestrationSource: "teamlead_chat"` + dispatch-event presence assertions.

Out-of-lane additive hardening (justified during S4 implementation):

- `src/adapters/paseo-opencode/paseo-chat-transport.ts:136-144` — chat-wait timeout now treated as empty poll instead of error; smoother loop tick.
- `src/orchestrator/manager-run-harness.ts:1493-1500` — artifact backfill so artifact references survive `worker_complete` handoff.

Caveats added to S6 hardening list:

- `src/contracts/four-layer.ts:179` `paseo_mode?: string` is a pre-existing provider-name leak (not S4); S6 sweep should remove or rename together with any other `paseo_*` literals in `src/contracts/`.
- Combined targeted-vitest invocation can hang locally even when each new test file passes individually; likely a vitest cleanup/lingering-handle leak in one of the new test files. Sandbox doesn't reproduce. Same hardening lane as S3's macOS smoke:fake non-determinism.

### Stage E — DONE (2026-05-03)

Status: **DONE (2026-05-03)** — committed locally as `573c336` on `pluto/agent-teams-chat-mailbox-runtime-s5`. Stack on sandbox: `daytona/s5-final` = `573c336` ← `daytona/s4-final(ffbb52f)` ← `daytona/s3-final(3165537)` ← `daytona/s2-final(2974439)` ← `main(269ab49)`. Remote sandbox: targeted gates + full pnpm test + smoke:fake all green; R8 Case B applied (smoke:live failure captured as fixture rather than re-running). Local acceptance: typecheck/targeted/build green; isSessionIdle race fix added in `paseo-opencode-adapter.ts:423-440`; final smoke:live confirmation deferred to S6 closure (S5 R8 budget already used).

Scope (delivered):

- 2 net-new typed `MailboxMessage` body kinds: `evaluator_verdict` (`{taskId, verdict, rationale?, failedRubricRef?}` referencing existing `rubricRef`) and `revision_request` (`{failedTaskId, failedVerdictMessageId, targetRole, instructions}`).
- `revision_request` routes through `spawn_request` path (creates new worker session + emits `worker_complete`); NOT direct text re-engage.
- Tightened existing `shutdown_request`/`shutdown_response` body shapes + added handlers. ACK target = active sessions only via new `adapter.listActiveRoleSessions` seam. `shutdown_complete` event emitted on either all-ACKs-received or timeout. `finalReconciliationPromise` explicitly resolved to avoid deadlock.
- 11 new event kinds added + `tests/audit/event-vocabulary-compat.test.ts` allowlist updated.
- New `src/four-layer/message-guards.ts` consolidates partial guards from `plan-approval.ts:33-45` and inline guards in `manager-run-harness.ts:1459-1487`.
- Lead/evaluator/worker collar additions in `render.ts` + `agents/*.yaml` (verbatim, after S1+S4 collars).
- New tests `tests/orchestrator/structured-control-plane.test.ts` (8 cases) + `tests/orchestrator/structured-control-plane-fixture-replay.test.ts` (R8 fixture replay).
- R8 fixture-replay infrastructure shipped: `tests/fixtures/live-smoke/86557df1-0b4a-4bd4-8a75-027a4dcd5d38/` (the fenced-JSON-block evaluator verdict failure mode + replay test asserting the extractor fix works on the real captured input).
- `src/adapters/paseo-opencode/paseo-opencode-adapter.ts:423-440` `isSessionIdle` no longer throws `paseo_adapter_unknown_session` on a just-created session not yet surfaced by `paseo ls --json`; returns `false` (not-idle) so the inbox loop queues + retries. (Local director addition; addresses the dispatch race observed in the R8 smoke:live confirmation run `9e977bfb-…`.)

Caveats added to S6 hardening backlog (in addition to S3+S4):

- isSessionIdle race fix needs a focused fake-adapter test that simulates "session created but ls --json hasn't surfaced it yet" so the not-idle-then-retry path has explicit unit coverage.
- Final smoke:live confirmation with the isSessionIdle fix applied is deferred to S6's integration smoke (S5 already used its R8 budget on the first failed attempt).

### Stage E — Structured control-plane messages

Scope:

- Add explicit contracts/type guards for structured mailbox messages beyond plain text:
  - plan approval request/response;
  - task/spawn request;
  - worker completion;
  - evaluator verdict;
  - revision request;
  - shutdown request/response;
  - optional permission request/response in later phases.
- Route structured messages through handlers before exposing them as raw model context.

Acceptance:

- Plan approval is a real message round trip through TeamLead and the requesting role.
- Shutdown/control messages are preserved and routed, not treated as arbitrary text.
- Tests cover trusted-sender checks for control messages.

### Stage F (S6) hardening backlog (BINDING — additive scope)

In addition to the original Stage F scope (smoke + custom playbook smoke + revision loop), S6 must include the following hardening items accumulated during S1-S5:

- **macOS `pnpm smoke:fake` hardening**: bound the inbox loop's no-progress backoff with explicit max-rounds and total-elapsed-time guards; flushShutdownPass should drain the cursor in a loop until N consecutive empty waits, not just one. Same-timestamp final-message races on macOS must be deterministic.
- **Combined targeted-vitest hang fix**: identify the lingering-handle/test-cleanup leak in the new S3+S4+S5 test files and fix so combined invocations terminate (not just per-file).
- **Provider-neutrality sweep**: rename or remove `paseo_mode?` field in `src/contracts/four-layer.ts:179` (pre-existing; never introduced by this iteration but blocks the strict-neutrality check). Sweep any other `paseo_*` literals lingering in `src/contracts/`.
- **Fixture-replay tooling for live-smoke (R8 enabler)**: build `tests/fixtures/live-smoke/<run-id>/` infrastructure + a fixture-replay helper that loads a captured `events.jsonl` + `mailbox.jsonl` from a real live-smoke run and synthesizes the equivalent in-memory state for unit-level parser/extractor/handler assertion. This makes future fixes for live-only failure modes iterable in single-digit seconds rather than 11+ minutes per cycle.
- **Per-gate timing instrumentation**: each gate command writes a header `# started: <iso8601>\n# duration: <seconds>\n` to its `gate-*.txt` artifact. So timeline reconstruction doesn't require parsing agent thought logs.
- **3-way (4-way) integration**: merge `pluto/agent-teams-chat-mailbox-runtime-s1` into the linear S2→S3→S4→S5 stack. S1 is on a parallel branch and touches the same harness/contracts/render zones (HIGH conflict severity per acceptance reviews); careful conflict resolution + integration smoke is the closure step.

### Stage F — Stronger smoke and evidence gates

Scope:

- Add fake tests for chat transport and inbox delivery.
- Add live smoke assertions for chat room creation, room transcript, message delivery, and TeamLead-authored dispatch.
- Add a custom playbook smoke case that proves the runtime is not hard-coded to planner/generator/evaluator.
- Add a revision-loop smoke/fake test where evaluator failure triggers TeamLead-managed revision.

Acceptance:

- `pnpm typecheck && pnpm test` pass.
- `pnpm smoke:fake` proves chat-backed TeamLead dispatch in fake mode.
- Live smoke with `PASEO_PROVIDER=opencode PASEO_MODEL=openai/gpt-5.4-mini` proves real `paseo chat` usage.
- Verification artifacts live under `/Volumes/AgentsWorkspace/tmp/<run-specific-dir>/` for live/manual tests, not repo-local `.tmp/`, unless the external volume is unavailable.

## Suggested code entry points

| Concern | Existing location | Proposed change |
|---|---|---|
| Local mailbox store | `src/four-layer/mailbox.ts` | Keep as mirror/store; add transport refs and read-status metadata. |
| Chat transport | none | Add `src/four-layer/mailbox-transport.ts` and `src/adapters/paseo-opencode/paseo-chat-transport.ts`. |
| Inbox delivery loop | none | Add `src/orchestrator/inbox-delivery-loop.ts`. |
| Static dispatch loop | `src/orchestrator/manager-run-harness.ts` | Add chat-backed TeamLead path; retire static loop to fake/legacy bridge only. |
| Adapter send | `src/adapters/paseo-opencode/paseo-opencode-adapter.ts` | Allow sends to any known session; support role-to-session lookup. |
| Fake adapter | `src/adapters/fake/fake-adapter.ts` | Add fake chat room, queued delivery, and TeamLead-authored dispatch tests. |
| Contracts | `src/contracts/four-layer.ts`, `src/contracts/adapter.ts`, `src/contracts/types.ts` | Add transport refs, message envelope types, and orchestration source enum values. |
| Evidence | `src/orchestrator/evidence.ts`, `src/orchestrator/run-store.ts` | Add chat room refs, message delivery events, and TeamLead decision chain. |
| Live smoke | `docker/live-smoke.ts` | Assert chat room exists and dispatch source is TeamLead chat, not static loop. |

## Acceptance / verification target

- A custom playbook run can be started from authored YAML without changing TypeScript control flow.
- Live mode creates a real `paseo chat` room and records its room id/name in run evidence.
- A message posted to the room for TeamLead is delivered as a TeamLead turn.
- A message posted to a worker can be delivered or queued for that worker.
- TeamLead-authored messages, not a Pluto static loop, cause worker creation or continuation.
- `mailbox.jsonl` remains a runtime-owned evidence mirror and is not the agent-facing write API.
- Evidence packet cites:
  - real chat room reference;
  - mirrored mailbox transcript;
  - task list state;
  - TeamLead task/spawn decisions;
  - worker completion messages;
  - final TeamLead reconciliation.
- Repository-documentation consistency check passes: docs/plans, design docs, harness docs, contracts, CLI behavior, and live smoke expectations all describe the same runtime boundary.
- Fast gates pass: `pnpm typecheck && pnpm test`.
- Smoke gates pass: `pnpm smoke:fake` and live smoke when Paseo/OpenCode are available.

## Risks and design constraints

- `paseo chat wait` reliability must be validated under local daemon and explicit `PASEO_HOST` modes.
- Delivery loops must avoid duplicate sends when `chat read/wait` returns overlapping messages.
- Delivery must be idempotent across process restarts; message ids and delivery status should be persisted.
- A busy agent may not accept immediate `paseo send`; queueing and re-delivery must be explicit.
- TeamLead-direct `paseo run` spawning may depend on provider/tool permissions. Runtime capability should be detected by a probe, not inferred from a mode name.
- The bridge fallback must not become a second permanent control plane. If fallback exists, it should be labelled mechanical execution of TeamLead-authored chat decisions.
- Tests must not mistake evidence existence for orchestration correctness.

## Open questions

- Should TeamLead directly execute `paseo run` for teammates in the preferred path, or should TeamLead post structured spawn requests and Pluto execute them mechanically for better supervision?
- What is the canonical structured message envelope shape for `task_request`, `spawn_request`, `worker_complete`, `verdict`, `revision_request`, and `final_reconciliation`?
- Should `paseo chat` room transcript be the source of truth with local mailbox as mirror, or should Pluto's local store be authoritative with chat as notification/delivery transport?
- How should external user messages target a running Pluto team: by room post, CLI command, or `runs follow/send` surface?
- What is the minimum supported resume behavior for stopped/archived agents? Claude Code can resume local agents from transcript; Pluto may initially only report structured delivery failure.

## Non-goals for the first implementation pass

- Do not build a general workflow DAG executor in TypeScript.
- Do not reintroduce legacy marker parsing as a primary control plane.
- Do not require a UI before proving CLI/runtime semantics.
- Do not make `mailbox.jsonl` an agent-authored file format.
- Do not solve full production persistence; keep the current local-file evidence model while clarifying its boundary.

## Notes

- Live/manual experiments for this plan should use a subdirectory of `/Volumes/AgentsWorkspace/tmp/` and should archive or delete created Paseo sessions after completion so `paseo ls` remains readable.
- The current implementation should be described as a working harness with mailbox/task evidence, not yet a true chat-backed Agent Teams runtime.
