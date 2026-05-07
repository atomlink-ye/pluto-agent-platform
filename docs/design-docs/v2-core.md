# Pluto v2 pure core (S2)

## Goal

S2 adds the pure event-sourced runtime core under `packages/pluto-v2-core/src/core/`.
The kernel accepts already-authored requests, validates them against the closed S1
schemas plus the frozen S2 authority rules, appends a `RunEvent`, and derives the next
`RunState` by replay-safe reduction.

## Intentionally absent

- No projections (`TaskProjectionView`, `MailboxProjectionView`, `EvidenceProjectionView`)
- No replay execution harness beyond `EventLogStore.read()` for snapshot/replay equality
- No runtime adapter, mailbox transport, helper CLI lineage, or CLI surface
- No persistence beyond the in-memory event log store

## RunKernel flow

`RunKernel.submit(rawRequest)` is synchronous and deterministic when the caller injects a
deterministic `idProvider` and `clockProvider`.

1. Parse `rawRequest` with `ProtocolRequestSchema`.
2. On parse failure, emit `request_rejected` with `schema_invalid` or `intent_unknown`.
3. On parse success, validate authority in fixed precedence:
   1. `actor_not_authorized`
   2. `entity_unknown`
   3. `state_conflict`
   4. `idempotency_replay`
4. Build the accepted or rejected `RunEvent` envelope.
5. Append to `EventLogStore`.
6. Reduce the event into the next `RunState`.
7. Return `{ event }`.

The only mutable runtime boundary in S2 is the append-only event log abstraction.

## AUTHORITY_MATRIX

| intent | allowed actors |
|---|---|
| `append_mailbox_message` | `kind: 'manager'`, `role: 'lead'`, `role: 'planner'`, `role: 'generator'`, `role: 'evaluator'`, `kind: 'system'` |
| `create_task` | `kind: 'manager'`, `role: 'lead'`, `role: 'planner'` |
| `change_task_state` | `kind: 'manager'` (any task); `role: 'lead'` (any task); `role: 'generator'` / `role: 'evaluator'` only for tasks where `state.tasks[taskId].ownerActor` matches the requesting actor; `role: 'planner'` only for `to: 'cancelled'` and `to: 'blocked'` |
| `publish_artifact` | `role: 'generator'` (any artifact); `role: 'lead'` (any artifact); `kind: 'manager'` (any artifact) |
| `complete_run` | `kind: 'manager'` |

Null-owner behavior for `change_task_state`: when `state.tasks[taskId].ownerActor === null`,
only `kind: 'manager'` and `role: 'lead'` are authorized.

## TRANSITION_GRAPH

```text
queued    → running, blocked, completed, failed, cancelled
running   → completed, blocked, failed, cancelled
blocked   → running, completed, failed, cancelled
completed → (terminal — no outgoing)
failed    → (terminal — no outgoing)
cancelled → (terminal — no outgoing)
```

`queued → completed` is REQUIRED.

## RunState shape rationale

`RunState` is deliberately minimal. It carries only what authority checks and event
envelope generation need:

- `runId`
- `sequence`
- `status`
- `tasks: Record<TaskId, { state, ownerActor }>`
- `acceptedRequestKeys: Set<string>`
- `declaredActors: Set<string>`

It intentionally excludes mailbox bodies, artifact catalogs, task histories, evidence
views, and summary projections. Those remain S3 concerns.

## EventLogStore interface

```ts
interface EventLogStore {
  /** Highest sequence stored, or -1 when empty. Sync because in-memory only in S2. */
  readonly head: number;
  /** Append must be called with event.sequence === head + 1, else throws SequenceGapError. */
  append(event: RunEvent): void;
  /** Read events with sequence in [from, to). `to` defaults to head+1. Returns a snapshot. */
  read(from?: number, to?: number): readonly RunEvent[];
  /** Lookup by eventId; throws DuplicateAppendError if the same eventId appears twice in append. */
  hasEventId(eventId: string): boolean;
}
```

S2 ships only `InMemoryEventLogStore`.

## Replay-equivalence proof sketch

Replay equivalence comes from three constraints:

1. `RunEventLog` is append-only and sequence-checked.
2. `reduce(state, event)` is pure and total over the closed event kind set.
3. Accepted-request idempotency is carried forward on accepted events via the internal
   `acceptedRequestKey` convention.

As a result, `eventLog.read(0, head + 1).reduce(reduce, initialState(teamContext))`
reconstructs the same final `RunState` that live submission produced.
