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

### Run-level events

- `run.created`
- `run.initialized`
- `run.started`
- `run.status_changed`
- `run.phase_changed`
- `run.blocked`
- `run.unblocked`
- `run.failed`
- `run.succeeded`
- `run.canceled`
- `run.archived`

### Phase and stage events

- `phase.entered`
- `phase.exited`
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
- `approval.approved`
- `approval.denied`
- `policy.blocked`
- `policy.allowed`
- `retry.scheduled`

### Artifact events

- `artifact.created`
- `artifact.updated`
- `artifact.registered`

### Operator events

- `operator.approval_resolved`
- `operator.run_canceled`
- `operator.run_retried`

## Contract rules

- events record facts, not vague summaries
- event history should be append-only where practical
- run state, current phase, blocker state, and recovery context should be explainable from events and projections
