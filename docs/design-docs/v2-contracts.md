# Pluto v2 contracts (S1)

## Goal

S1 freezes the declarative contract surface for Pluto v2: closed schemas for run events and protocol requests, a closed rejection taxonomy, declarative projection contracts, a replay-fixture file format, and versioning rules. S1 does not ship runtime behavior.

## Contract boundaries

- In scope: zod schemas, TypeScript types, projection view contracts, replay-fixture format, replay acceptance rules as prose, versioning policy
- Out of scope: executable reducers, replay execution, kernel logic, adapters, CLI surfaces, runtime helper lineage, and deferred product surfaces such as approval, publish-package, schedule, RBAC, tenancy, and `FinalReportProjectionView`

## RunEvent envelope

Every `RunEvent` carries the same envelope:

- `eventId`
- `runId`
- `sequence`
- `timestamp`
- `schemaVersion`
- `actor`
- `requestId`
- `causationId`
- `correlationId`
- `entityRef`
- `outcome`

`RunEvent.kind` is closed at v1.0.

Accepted kinds:

- `run_started`
- `run_completed`
- `mailbox_message_appended`
- `task_created`
- `task_state_changed`
- `artifact_published`

Rejected kind:

- `request_rejected`

## ActorRef and EntityRef closure rationale

`ActorRef` is identity only. Its closed arms are:

- `{ kind: 'manager' }`
- `{ kind: 'role', role: 'lead' | 'planner' | 'generator' | 'evaluator' }`
- `{ kind: 'system' }`

`EntityRef` is the closed v1.0 entity set:

- `{ kind: 'run', runId: string }`
- `{ kind: 'task', taskId: string }`
- `{ kind: 'mailbox_message', messageId: string }`
- `{ kind: 'artifact', artifactId: string }`

Deferred surfaces such as approval, publish-package, schedule, RBAC, tenancy, and helper-path lineage are intentionally excluded. Adding a new role or entity kind is a major-version change.

## ProtocolRequest intent set and request → event mapping

`ProtocolRequest.intent` is closed at v1.0:

- `append_mailbox_message`
- `create_task`
- `change_task_state`
- `publish_artifact`
- `complete_run`

| `ProtocolRequest.intent` | Accepted `RunEvent.kind` (on success) | Server-assigned fields the kernel adds |
|---|---|---|
| `append_mailbox_message` | `mailbox_message_appended` | `messageId` |
| `create_task` | `task_created` | `taskId` |
| `change_task_state` | `task_state_changed` | (none — `taskId` and `to` come from request; `from` resolved from prior state) |
| `publish_artifact` | `artifact_published` | `artifactId` |
| `complete_run` | `run_completed` | `completedAt` |

Worked examples, one per intent:

- `append_mailbox_message`: a manager appends a planner-directed `plan` message; the kernel assigns `messageId` when emitting `mailbox_message_appended`.
- `create_task`: a manager requests a task titled "Write tests" with an optional owner; the kernel assigns `taskId` when emitting `task_created`.
- `change_task_state`: a generator requests `task-1 -> running`; the accepted event records both requested `to` and resolved prior `from`.
- `publish_artifact`: a manager requests publication of a `final` markdown artifact; the kernel assigns `artifactId` when emitting `artifact_published`.
- `complete_run`: a manager requests run completion with `status` and optional `summary`; the kernel adds `completedAt` on `run_completed`.

`run_started` is system-emitted and has no corresponding `ProtocolRequest` intent.

## Rejection taxonomy

`RejectionReason` is closed at v1.0:

- `actor_not_authorized` — example: a role attempts an action outside its authority window
- `entity_unknown` — example: a request references a missing task or artifact id
- `state_conflict` — example: a task state transition conflicts with current projected state
- `schema_invalid` — example: the inbound request fails structural validation
- `idempotency_replay` — example: the same `(runId, actor, intent, idempotencyKey)` is replayed
- `intent_unknown` — example: an unrecognized request intent reaches the kernel boundary

S1 proves schema reachability for every rejection reason via valid `request_rejected` events. The authority semantics that cause those reasons are deferred to S2.

## Projection-as-contract rules

S1 exports exactly three projection contracts:

- `TaskProjectionView`
- `MailboxProjectionView`
- `EvidenceProjectionView`

Each contract declares:

- `view`: the closed derived-state shape
- `inputKinds`: the event kinds the future reducer consumes
- `outOfScopeKinds`: every remaining `RunEvent.kind`

The contract rule is exact coverage: `inputKinds ∪ outOfScopeKinds = AllKinds` and `inputKinds ∩ outOfScopeKinds = ∅`. This forces an explicit projection decision whenever a future major introduces a new kind.

`FinalReportProjectionView` is deferred and must not appear in S1.

## Replay acceptance rules

S1 defines replay constraints as prose only. S3 reducers must satisfy:

- Reducer idempotency: applying the same fixture twice yields identical view state
- Reducer purity: reducers are total over their `inputKinds` and depend only on prior view state plus the ordered event stream
- Forward compatibility: kinds outside `inputKinds` are ignored rather than treated as errors
- Deterministic serialization: serialized views are stable so fixture comparisons are exact

S1 fixtures validate schema shape only. They do not execute replay machinery.

## Versioning policy

- `schemaVersion` is `"<major>.<minor>"`; S1 ships `"1.0"`
- Within the same major, only additive optional fields are allowed
- Unknown optional fields parse and are stripped by zod's default object behavior
- Closed enums stay closed within major version `1.x`; new `kind`, `intent`, `RejectionReason`, `ActorRef.role`, or `EntityRef.kind` values require a major bump
- Different-major input (for example `2.0`) is rejected in S1 because no migrator ships in this slice

## Legacy evidence-surface coverage

| Legacy surface (under `.pluto/runs/<runId>/`) | v2 projection | Status |
|---|---|---|
| `mailbox.jsonl` | `MailboxProjectionView` | in scope (S1 contract; S3 reducer) |
| `tasks.json` | `TaskProjectionView` | in scope (S1 contract; S3 reducer) |
| `evidence-packet.{md,json}` | `EvidenceProjectionView` | in scope (S1 contract; S3 reducer) |
| `events.jsonl` | `RunEventLog` (S2) | n/a for S1; oracle for fixtures |
| `artifact.md` | `EvidenceProjectionView` (artifact citations) | in scope (S1 contract; S3 reducer; payload from `artifact_published` event) |
| `final-report.md` | `FinalReportProjectionView` (deferred to S3 reconsideration) | **DEFERRED — must NOT appear in S1** |
| `status.md` | derived from `EvidenceProjectionView` + `TaskProjectionView` | **DEFERRED to later slice** |
| `task-tree.md` | derived from `TaskProjectionView` | **DEFERRED to later slice** |
| `workspace-materialization.json` | runtime artifact, not a projection | **DEFERRED — not a contract concern** |
| `runtime-helper-usage.jsonl` | helper-CLI lineage | **OUT OF SCOPE — handoff "stop carrying forward" item** |
| inbox mirrors (e.g. `roles/<role>/inbox.jsonl`) | helper-CLI lineage | **OUT OF SCOPE — handoff "stop carrying forward" item** |

The deferred rows stay out of the S1 public package surface.
