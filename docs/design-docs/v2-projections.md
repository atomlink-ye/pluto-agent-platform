# Pluto v2 projections (S3)

## Goal

S3 turns the S1 declarative projection contracts into pure, deterministic reducers plus replay helpers over ordered `RunEvent[]` streams.

## Boundary

- In scope: `TaskProjectionView`, `MailboxProjectionView`, `EvidenceProjectionView`, reducer state accumulators, replay helpers, and replay tests
- Out of scope: runtime adapters, CLI/kernel/I-O, ambient randomness/time, and `FinalReportProjectionView`

## Reducer state shapes

These state shapes stay verbatim in S3:

```ts
type TaskReducerState = { view: TaskProjectionView['view'] };
type MailboxReducerState = { view: MailboxProjectionView['view']; seenMessageIds: ReadonlySet<string> };
type EvidenceReducerState = { view: EvidenceProjectionView['view']; pendingStartedAt: string | null; seenEventIds: ReadonlySet<string> };
```

Replay extracts `.view` from the final reducer state.

## Binding table (verbatim)

```text
run_started => task no-op, mailbox no-op, evidence citation "Run started." + pendingStartedAt
run_completed => task no-op, mailbox no-op, evidence citation "Run completed." + populate view.run + reset pendingStartedAt
mailbox_message_appended => task no-op, mailbox append dedup by messageId, evidence no-op
task_created => task insert queued dedup by taskId, mailbox no-op, evidence no-op
task_state_changed => task update + history dedup by eventId, mailbox no-op, evidence no-op
artifact_published => all no-op except evidence still no-op
request_rejected => all no-op
```

## Per-kind reducer behavior + fixture coverage

This is the binding fixture-coverage table referenced by the S3 acceptance bar
(plan deliverable 7). Every `RunEvent.kind` declared in S1 maps to a specific
behavior in each of the three v1.0 projection reducers, and every cell is
exercised by at least one test in
`packages/pluto-v2-core/__tests__/projections/`.

| event kind | task | mailbox | evidence | covered by fixture / test |
|---|---|---|---|---|
| `run_started` | no-op | no-op | citation `"Run started."` + `pendingStartedAt` | `basic-run.json` events[0]; `evidence-projection.test.ts`, `replay-all.test.ts` |
| `run_completed` | no-op | no-op | citation `"Run completed."` + populate `view.run` + reset `pendingStartedAt` | `basic-run.json` events[4]; `evidence-projection.test.ts`, `replay-all.test.ts` |
| `mailbox_message_appended` | no-op | append with `messageId` dedup | no-op | `basic-run.json` events[1]; `mailbox-projection.test.ts`, `evidence-projection.test.ts` (no-view-delta) |
| `task_created` | insert queued task with `taskId` dedup | no-op | no-op | `basic-run.json` events[2]; `task-projection.test.ts`, `evidence-projection.test.ts` (no-view-delta) |
| `task_state_changed` | update task state + append history with `eventId` dedup | no-op | no-op | `basic-run.json` events[3]; `task-projection.test.ts`, `evidence-projection.test.ts` (no-view-delta) |
| `artifact_published` | no-op | no-op | no-op | `task-projection.test.ts` (no-input no-op); `evidence-projection.test.ts` (no-view-delta) |
| `request_rejected` | no-op | no-op | no-op | `evidence-projection.test.ts` (no-view-delta) |

The basic-run fixture exercises 5 of 7 kinds end-to-end through `replayAll`;
the remaining 2 (`artifact_published`, `request_rejected`) are exercised by
synthetic events in the unit tests since the v1.0 fixture doesn't include
them. All cells map to at least one assertion.

Additional binding notes:

- `TaskProjectionView` starts at `{ tasks: {} }`.
- `MailboxProjectionView` starts at `{ messages: [] }`.
- `EvidenceProjectionView` starts at `{ run: null, citations: [] }`.
- `view.run` stays `null` until `run_completed` arrives.
- Evidence citations are fixed strings only: `"Run started."` and `"Run completed."`.
- `mailbox_message_appended`, `task_created`, `task_state_changed`, `artifact_published`, and `request_rejected` remain evidence no-ops in v1.0 even though they are part of `EVIDENCE_PROJECTION_INPUT_KINDS`.

## Replay API

- `replayTask(events)` folds `TaskReducerState` and returns `view`
- `replayMailbox(events)` folds `MailboxReducerState` and returns `view`
- `replayEvidence(events)` folds `EvidenceReducerState` and returns `view`
- `replayAll(events)` returns `{ task, mailbox, evidence }`
- `replayFromStore(store)` calls `store.read()` and then `replayAll(...)`

`replayAll([])` returns the three initial views.

## Determinism and idempotency

- Mailbox append dedups by `messageId`
- Task creation dedups by `taskId`
- Task history dedups by `eventId`
- Evidence citations dedup by `eventId`
- Stable replay means the same ordered event stream yields byte-equal stable JSON output across runs

## `FinalReportProjectionView` decision

`FinalReportProjectionView` is deferred in S3.

- The legacy `final-report.md` can be derived from `EvidenceProjectionView` (run summary + citations), `TaskProjectionView` (task tree / state), and `MailboxProjectionView` (final manager message) without adding a new v1.0 contract.
- If a later slice proves a dedicated projection is necessary, it must be introduced as a separate approved slice because adding a new projection changes the closed contract surface.
