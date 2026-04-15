# Run Event Contract

## Purpose

Define the canonical event envelope and minimum event categories for governed run execution.

Run state should remain explainable through an append-only event log rather than only current-state snapshots.

## Event envelope

```ts
type RunEventEnvelope<TPayload = unknown> = {
  id: string
  runId: string
  eventType: string
  occurredAt: string
  source: "system" | "orchestrator" | "session" | "operator" | "policy"
  phase?: string | null
  stageId?: string | null
  sessionId?: string | null
  roleId?: string | null
  payload: TPayload
  traceId?: string
  correlationId?: string
}
```

## Event categories

### Event authority — current reality

**State transition authority:** `run.status_changed` is the **sole state-transition event** emitted by the current system. All run status changes flow through `run-service.ts:transition()`, which emits `run.status_changed` with `fromStatus` and `toStatus` in the payload.

**Semantic milestone events:** `runtime-adapter.ts` emits `run.completed` (when an agent finishes) and `run.failed` (when an agent errors). These are semantic milestones from the runtime, not state-machine transitions. `run.failed` is consumed by the event projector; `run.completed` is **not** consumed by the projector for state reconstruction.

**Legacy event consumption:** The projector (`projectRunStateFromEvents()`) still recognizes legacy event names (`run.initialized`, `run.started`, `run.succeeded`, `run.canceled`, `run.archived`) in its switch statement. These names are **not emitted** by current code but remain in the projector to support replaying historical event logs from before the migration to `run.status_changed`. Removing these cases would break historical replay.

**Replay dependency:** Successful state reconstruction depends on `run.status_changed` being present in the event stream for all modern runs. The projector does not derive terminal state from `run.completed` — it relies on `run.status_changed` carrying the `toStatus` value.

The following list reflects the event names that are currently emitted by the control-plane services.

### Run-level events

- `run.created`
- `run.status_changed`
- `run.completed`
- `run.failed`

### Phase and stage events

- `phase.entered`
- `phase.exited`
- `phase.rejected`
- `phase.timeout`
- `stage.created`
- `stage.started`
- `stage.completed`
- `stage.failed`
- `stage.skipped`
- `stage.blocked`

### Session and role events

- `session.created`
- `session.started`
- `session.status_changed`
- `session.interrupted`
- `session.resumed`
- `session.closed`
- `role.assigned`
- `role.released`

### Coordination events

- `handoff.created`
- `handoff.accepted`
- `handoff.rejected`
- `room.created`
- `room.message_posted`
- `room.summary_emitted`
- `heartbeat.checked`

### Tool and action events

- `tool.started`
- `tool.finished`
- `tool.failed`
- `action.started`
- `action.finished`
- `action.failed`

### Governance events

- `approval.requested`
- `approval.resolved`
- `policy.blocked`
- `policy.allowed`
- `retry.scheduled`

### Artifact events

- `artifact.created`
- `artifact.updated`
- `artifact.registered`

### Operator events

- `operator.run_canceled`
- `operator.run_retried`

## Legacy and reserved event names

### Legacy — consumed by projector but no longer emitted

The following event names are **not emitted** by current code but **are consumed** by `projectRunStateFromEvents()` for backward-compatible replay of historical event logs. They must not be removed from the projector until all historical events have been migrated or replaying pre-migration runs is no longer required.

- `run.initialized` — projector sets status to `initializing`
- `run.started` — projector sets status to `running`
- `run.succeeded` — projector sets status to `succeeded`
- `run.canceled` — projector sets status to `canceled`
- `run.archived` — projector sets status to `archived`

### Reserved — not emitted, not consumed

The following names are reserved for future expansion but have no current emitter or consumer:

- `run.phase_changed`
- `run.blocked`
- `run.unblocked`
- `approval.approved`
- `approval.denied`
- `operator.approval_resolved`

## Contract rules

- events record facts, not vague summaries
- event history should be append-only where practical
- run state, current phase, blocker state, and recovery context should be explainable from events and projections
