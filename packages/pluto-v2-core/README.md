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
- `RunStateSchema`, `initialState`, `composeRequestKey`
- `reduce`
- `EventLogStore`, `InMemoryEventLogStore`, `SequenceGapError`, `DuplicateAppendError`
- `validate`
- `AUTHORITY_MATRIX`, `TRANSITION_GRAPH`, `actorAuthorizedForIntent`, `transitionLegal`
- `RunKernel`, `defaultIdProvider`, `defaultClockProvider`, `counterIdProvider`, `fixedClockProvider`

S2 boundaries:

- No projections or replay reducers
- No runtime adapter or CLI integration
- No persistence beyond the in-memory `EventLogStore`
- Determinism comes from injected id/clock providers
