# @pluto/v2-core

Declarative Pluto v2 contract package for S1.

## Public surface

- `actor-ref`: `ActorRefSchema`, role/kind enums, and `ActorRef` types
- `entity-ref`: `EntityRefSchema`, kind enums, and entity reference types
- `authority-outcome`: `AuthorityValidationOutcomeSchema`, `RejectionReasonSchema`, and related types
- `run-event`: `RunEventSchema`, accepted/rejected event schemas, payload schemas, kind enums, and event types
- `protocol-request`: `ProtocolRequestSchema`, intent schemas, payload schemas, and request types
- `projections`: declarative `TaskProjectionView`, `MailboxProjectionView`, `EvidenceProjectionView` contracts, coverage helpers, and view schemas
- `replay-fixture`: `ReplayFixtureSchema` and `ReplayFixture` types for hand-written fixture files
- `versioning`: `SCHEMA_VERSION`, schema-version validators, and versioning policy helpers

## Scope boundary

- No executable reducers
- No replay execution machinery
- No runtime, kernel, adapter, or CLI code

Executable reducers and replay machinery live in S3, not S1.

## Pure core (S2)

S2 adds the pure event-sourced runtime core without introducing I/O, adapters, replay
machinery, or CLI behavior.

Public core surface:

- `compile`, `AuthoredSpecSchema`, `TeamContextSchema`
- `FakeScriptStepSchema` for deterministic fake-runtime authored steps
- `RunStateSchema`, `initialState`, `composeRequestKey`
- `reduce`
- `EventLogStore`, `InMemoryEventLogStore`, `SequenceGapError`, `DuplicateAppendError`
- `validate`
- `CANONICAL_AUTHORITY_POLICY` (`AUTHORITY_MATRIX` remains as a deprecated alias), `TRANSITION_GRAPH`, `actorAuthorizedForIntent`, `transitionLegal`
- `RunKernel`, `defaultIdProvider`, `defaultClockProvider`, `counterIdProvider`, `fixedClockProvider`

S2 boundaries:

- No projections or replay reducers
- No runtime adapter or CLI integration
- No persistence beyond the in-memory `EventLogStore`
- Determinism comes from injected id/clock providers

S4 adds two strictly additive extensions used by `@pluto/v2-runtime`: optional
`fakeScript` authoring on `AuthoredSpecSchema`, and `RunKernel.seedRunStarted(...)`
for the system-emitted `run_started` event.

## Projections and replay (S3)

S3 adds pure executable projection reducers and replay helpers:

- `taskReducer`, `initialTaskState`, `replayTask`
- `mailboxReducer`, `initialMailboxState`, `replayMailbox`
- `evidenceReducer`, `initialEvidenceState`, `replayEvidence`
- `replayAll(events)` and `replayFromStore(store)`

Projection replay is deterministic, in-memory only, and contains no runtime
adapter, CLI, persistence, or parsing I/O. `FinalReportProjectionView` remains
deferred; consumers compose the task, mailbox, and evidence views for v1.0.
