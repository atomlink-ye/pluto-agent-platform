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

The current implementation relies on `run.status_changed` as the canonical durable run-state transition event. Some more specific event names remain reserved for future expansion, but the following list reflects the event names that are currently emitted by the control-plane services and server scaffold.

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

## Reserved forward-compatible names

The following names may still appear in projections, tests, or future extensions, but they are not the current minimum emitted set:

- `run.initialized`
- `run.started`
- `run.succeeded`
- `run.canceled`
- `run.archived`
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
