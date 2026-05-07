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
