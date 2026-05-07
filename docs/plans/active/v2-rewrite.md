# Plan: Pluto v2 rewrite — event-sourced RunKernel

## Goal

Replace the v1.6 manager-run harness with a clean event-sourced core: an append-only
`RunEventLog` as the source of truth, projections derived from events, and provider-agnostic
runtime adapters. The v1.6 implementation under `src/orchestrator/manager-run-harness.ts`
plus the file-backed mailbox/task lineage stays available as a legacy reference oracle on
the `legacy-v1.6-harness-prototype` branch but is no longer the architecture target.

The thesis, taken verbatim from the handoff:

> Preserve the validated workflow evidence. Freeze the current implementation as Legacy.
> Rebuild main around a clean event-sourced RunKernel.

## Source-of-truth references

- Handoff: `.local/active/handoff/pluto-v2-rewrite-handoff.md`
- VPS sandbox env probe: `.local/active/handoff/pluto-v2-vps-sandbox-env-probe-2026-05-07.md`
- Iteration workflow: `.local/manager/Pluto Iteration Workflow.md`
- Remote orchestration workflow: `.local/manager/Pluto Remote Orchestration Workflow.md`
- Operating rules: `.local/manager/operating-rules.md`
- Notion clone index: `.local/references/docs/notion-pluto-2026-05-06/_index.md`

## Scope

### Included

- v2 contract design (RunEvent, ProtocolRequest, AuthorityValidationOutcome, projections, replay rules) as schemas + design docs.
- Pure v2 core: `SpecCompiler`, `RunKernel`, `RunState` reducer, `RunEventLog`, `ProtocolValidator`, authority checks. No runtime dependency.
- Projections derived from `RunEventLog`: task projection, mailbox projection, evidence projection, final-report projection (where required).
- Replay tests: `events.jsonl → projections → diff/acceptance`.
- Fake runtime wired through the v2 path end-to-end.
- Provider-agnostic Paseo runtime adapter (`PaseoRuntimeAdapter`) and a thin `PaseoCliClient`. Provider/model/mode are runtime config, not architecture boundaries.
- One bounded Paseo live smoke through the v2 path.
- CLI default switch for `pluto:run` to v2 once acceptance gates clear.
- Archive/removal of v1.6 mainline runtime once v2 is accepted.

### Excluded (deferred until v2 core is proven)

- Paseo daemon long-lived workers.
- MCP tool protocol surface.
- Review / Approval / PublishPackage / RBAC / multi-tenant / marketplace / schedule / compliance.
- UI-first dashboard.
- Broad analytics / cost controls.
- Bug-for-bug v1.6 compatibility (workflow + evidence + acceptance compatibility only).

## Architecture target

```text
Agent / Playbook / Scenario / RunProfile
  -> SpecCompiler -> TeamContext
  -> protocol request
  -> RunKernel authority validation
  -> append-only RunEventLog
  -> projections: tasks / mailbox / evidence
  -> EvidencePacket
  -> replay
```

Core invariants:

```text
Agent output is input.
Protocol message is a request.
Harness validation creates state.
RunEventLog is the source of truth.
Projection is derived state.
Evidence is an audit projection.
Replay proves consistency.
```

## Slice list

The plan runs as a pipeline. Each slice is an independent acceptance unit, gated by local
OpenCode discovery review (`@oracle` + `@council`) before remote dispatch and by local
acceptance review after remote completion.

| Slice | Phase | Owner | Output |
|---|---|---|---|
| S0 | Phase 0 | local | Legacy snapshot branch + v1.6-as-legacy banners + this plan |
| S1 | Phase 1 | remote | v2 contract package: closed zod schemas (`RunEvent`, `ProtocolRequest`, `AuthorityValidationOutcome`, `ActorRef`, `EntityRef`, `RejectionReason`), declarative projection **interfaces** (no reducer code), replay-fixture file format (no replay machinery), versioning policy, schema-only tests, README + design doc. Under `packages/pluto-v2-core/`. |
| S2 | Phase 2 | remote | Pure core (`SpecCompiler`, `RunKernel`, `RunEventLog`, `RunState` reducer, `ProtocolValidator`, authority checks) + unit tests. Imports `pluto-v2-core` schemas. No projections, no replay tests yet. |
| S3 | Phase 3 | remote | Executable projection reducers (Task / Mailbox / Evidence) implementing the S1 contracts + replay machinery + replay tests over fixture event streams. Reconsiders `FinalReportProjectionView`: implement only if the deferred `final-report.md` / `status.md` / `task-tree.md` evidence is required and not derivable from the three core projections. |
| S4 | Phase 4 | remote | Fake runtime end-to-end through v2 path + parity check vs. legacy fixtures. |
| S5 | Phase 5 | remote | `PaseoRuntimeAdapter` + `PaseoCliClient` thin wrapper + one bounded Paseo live smoke. |
| S6 | Phase 6 | remote | `pluto:run` default switched to v2; legacy v1 opt-in for one transition window. |
| S7 | Phase 7 | remote | Archive/remove v1.6 mainline runtime; keep only reference fixtures/docs. |

## S0 — Phase 0 (closing)

Goal: freeze legacy state without disrupting active branches; mark current shipped runtime
as legacy in top-level docs.

Done in S0:

- [x] `legacy-v1.6-harness-prototype` branch created from `main` and pushed to `origin`.
- [ ] `README.md` and `ARCHITECTURE.md` carry a v2-rewrite banner pointing to this plan.
- [ ] `docs/plans/active/runtime-helper-paseo-live-hello-team.md` and any other v1.6-runtime
      plans get a "legacy plan, see v2-rewrite" banner.
- [ ] This plan file (`docs/plans/active/v2-rewrite.md`) committed to `main`.

S0 acceptance: doc updates reviewed locally and committed; legacy branch reachable on
`origin/legacy-v1.6-harness-prototype`.

## S1 — Phase 1: v2 contracts (current slice)

### S1 / S3 boundary (binding)

S1 owns **declarative contract surface only**: zod schemas, TypeScript types, projection
**interfaces** (input-kind sets, output view types), replay-fixture file format, replay
acceptance **rules as prose**, versioning policy. S1 does NOT contain executable
reducers, replay machinery, or any code that consumes a `RunEvent[]` and produces a
projection. That executable code is S3.

If a deliverable below requires runtime behavior (e.g. an idempotent reducer), it belongs
in S3, not S1. The S1 acceptance bar checks this explicitly.

### Outcome

Self-contained contract package (`packages/pluto-v2-core/`) with closed schemas, no
runtime deps beyond `zod`, no executable reducers, no runtime/adapter/CLI code. Imported
by S2..S6.

### Concrete deliverables

1. **Package skeleton.** `packages/pluto-v2-core/` with `package.json` (`type: module`,
   ESM only, deps: `zod`; devDeps: `vitest`, `@types/node`, `typescript`),
   `tsconfig.json` (strict on, extends root if a base config exists), `src/index.ts`
   re-exporting the public surface.

2. **`RunEvent` schema as a discriminated union with closed `kind` set.**

   Common envelope fields on every accepted event:
   - `eventId: string` — UUIDv4 of the event itself; unique within the run.
   - `runId: string` — owning run id.
   - `sequence: number` — strictly monotonic non-negative integer per `runId`. Sequence 0
     is the first event of a run.
   - `timestamp: string` — RFC 3339 UTC.
   - `schemaVersion: string` — `"<major>.<minor>"`, initial `"1.0"`. See deliverable 7.
   - `actor: ActorRef` — closed union (deliverable 2a).
   - `requestId: string | null` — id of the originating `ProtocolRequest`; null only for
     synthetic system events emitted without a request (e.g. `run_started` boot event).
   - `causationId: string | null` — `eventId` of the prior event that directly caused
     this event (e.g. a request-rejected caused by an earlier accepted event); null when
     not applicable.
   - `correlationId: string | null` — opaque tag grouping related events across runs
     (e.g. retried runs of the same scenario).
   - `entityRef: EntityRef` — closed union (deliverable 2b).
   - `outcome: 'accepted' | 'rejected'` — discriminator (deliverable 2c).

   Closed `kind` enum for **accepted** events (initial v1.0 set, additive within major):

   - `run_started`
   - `run_completed`
   - `mailbox_message_appended`
   - `task_created`
   - `task_state_changed`
   - `artifact_published`

   Per-`kind` payload schema (zod discriminated union on `kind`):

   - `run_started`: `{ scenarioRef: string, runProfileRef: string, startedAt: string }`
   - `run_completed`: `{ status: 'succeeded' | 'failed' | 'cancelled', completedAt: string, summary: string | null }`
   - `mailbox_message_appended`: `{ messageId: string, fromActor: ActorRef, toActor: ActorRef | { kind: 'broadcast' }, kind: 'plan' | 'task' | 'completion' | 'plan_approval_request' | 'plan_approval_response' | 'final', body: string }`
     — note: `plan_approval_request` and `plan_approval_response` here are **mailbox
     message subtypes** representing the lead↔planner plan-approval workflow as
     in-band evidence. They are NOT the deferred Approval product surface (formal
     Approval / RBAC / reviewer workflow) listed in the handoff's deferred list. The
     v2 core MUST NOT model the deferred Approval surface as an `EntityRef` kind or
     `ProtocolRequest` intent.
   - `task_created`: `{ taskId: string, title: string, ownerActor: ActorRef | null, dependsOn: string[] }`
   - `task_state_changed`: `{ taskId: string, from: TaskState, to: TaskState }` where `TaskState = 'queued' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled'`.
   - `artifact_published`: `{ artifactId: string, kind: 'final' | 'intermediate', mediaType: string, byteSize: number }`

   **Rejected** events have shape:

   - `outcome: 'rejected'`
   - `kind: 'request_rejected'`
   - `payload: { rejectionReason: RejectionReason, rejectedRequestId: string, detail: string }`

   Where `RejectionReason` is the closed taxonomy from deliverable 4.

   The S1 schema MUST be a single discriminated zod union of all the above shapes such
   that `RunEventSchema.parse(unknown)` accepts every valid example (including a valid
   `request_rejected` event for each `RejectionReason`) and rejects any input that
   violates the **structural** rules (missing required fields, wrong types, out-of-enum
   discriminator values, out-of-enum `EntityRef.kind`, out-of-enum `ActorRef.role`,
   etc.). The schema does NOT enforce authority semantics — a valid `request_rejected`
   event with `payload.rejectionReason: 'state_conflict'` parses successfully because
   the event is the kernel's record that authority rejected the request; the conflict
   itself is detected by S2 authority logic, not by the schema.

   See deliverable 9 for the precise test split (taxonomy reachability vs schema
   rejection).

   2a. **`ActorRef` closed union**: `{ kind: 'manager' } | { kind: 'role', role: 'lead' | 'planner' | 'generator' | 'evaluator' } | { kind: 'system' }`. The `role` set is closed at v1.0; adding new roles requires a major version bump (see deliverable 7). The contract MUST NOT model role-bound helper paths or helper CLI lineage; `ActorRef` is identity, not transport.

   2b. **`EntityRef` closed union**: `{ kind: 'run', runId: string } | { kind: 'task', taskId: string } | { kind: 'mailbox_message', messageId: string } | { kind: 'artifact', artifactId: string }`. Deferred surfaces (approval, publish-package, schedule, RBAC, etc.) are NOT included; major bump required to add them.

   2c. **`outcome` discriminator semantics**: `outcome` is the **event-level** result of
   the originating ProtocolRequest's authority + schema validation. `accepted` events
   carry domain payloads; `rejected` events carry only the rejection reason and detail.
   `outcome` is NOT an authority outcome alias; it is the kernel's decision on whether
   to mutate state. Authority outcomes are inputs to that decision, defined in
   deliverable 4.

3. **`ProtocolRequest` schema.**

   Closed `intent` enum at v1.0 (one intent per event kind that a non-system actor can
   originate; system kinds like `run_started` do not have a corresponding request):

   - `append_mailbox_message`
   - `create_task`
   - `change_task_state`
   - `publish_artifact`
   - `complete_run` (the request a manager makes to close out a run)

   Common fields:
   - `requestId: string` — UUIDv4
   - `runId: string`
   - `actor: ActorRef`
   - `intent: <closed enum>`
   - `payload: <discriminated by intent, zod union>`
   - `idempotencyKey: string | null` — combined with `(runId, actor, intent)` for replay
     detection.
   - `clientTimestamp: string` — RFC 3339; advisory.
   - `schemaVersion: string`

   Note: `ProtocolRequest` does NOT carry a top-level `entityRef`. The entity is
   identified by the per-intent payload's `*Id` fields (e.g.
   `change_task_state.payload.taskId`). The kernel constructs the corresponding
   `RunEvent.entityRef` from the request payload when emitting an accepted event.

   Per-intent payload schemas mirror the corresponding accepted-event payload, minus
   server-assigned fields (`messageId`, `taskId` for newly-created tasks, etc.). The
   exact mapping (binding for S1):

   | `ProtocolRequest.intent` | Accepted `RunEvent.kind` (on success) | Server-assigned fields the kernel adds |
   |---|---|---|
   | `append_mailbox_message` | `mailbox_message_appended` | `messageId` |
   | `create_task` | `task_created` | `taskId` |
   | `change_task_state` | `task_state_changed` | (none — `taskId` and `to` come from request; `from` resolved from prior state) |
   | `publish_artifact` | `artifact_published` | `artifactId` |
   | `complete_run` | `run_completed` | `completedAt` |

   System-emitted accepted kinds (`run_started`) have no corresponding `ProtocolRequest`
   intent and are emitted by the kernel directly.

   `request_rejected` events are emitted by the kernel for any of the five intents when
   authority or schema validation fails. The same `requestId` is preserved on the
   rejection event's `rejectedRequestId` payload field.

   The design doc (`docs/design-docs/v2-contracts.md`) reproduces this table verbatim
   and adds one worked example per intent.

4. **`AuthorityValidationOutcome` and closed `RejectionReason` taxonomy.**

   `AuthorityValidationOutcome = { ok: true } | { ok: false, reason: RejectionReason, detail: string }`.

   Closed `RejectionReason` taxonomy at v1.0; adding new reasons requires a major
   version bump (see deliverable 7).

   - `actor_not_authorized` — actor does not have the role required for this intent.
     Schema-level proxy: `ActorRef.role` outside the closed set is rejected by the
     ProtocolRequest schema.
   - `entity_unknown` — a `*Id` in the request payload references a non-existent
     entity for the run; OR the request references an `EntityRef.kind` outside the
     closed set. Schema-level proxy: `RunEvent.entityRef.kind` outside the closed
     set is rejected by the RunEvent schema.
   - `state_conflict` — the request would violate run state (e.g. `task_state_changed`
     from a state that disallows the target). Authority-only; no schema-level proxy.
   - `schema_invalid` — request did not parse against the zod schema. This is the
     catch-all for structural rejection.
   - `idempotency_replay` — `(runId, actor, intent, idempotencyKey)` already produced
     an accepted event. Authority-only; no schema-level proxy.
   - `intent_unknown` — `intent` is not in the closed enum. Schema-level proxy:
     `ProtocolRequest.intent` outside the closed enum is rejected.

   The "schema-level proxy" rows describe how S1 tests can validate the closure of
   each enum even though full authority checking lives in S2. See deliverable 9.

5. **Projection contract interfaces (declarative only, no executable reducer).**

   For each of:

   - `TaskProjectionView`
   - `MailboxProjectionView`
   - `EvidenceProjectionView`

   declare a TypeScript / zod interface containing:

   - `view: <ViewShape>` — the closed shape of the derived view.
   - `inputKinds: ReadonlyArray<RunEventKind>` — the closed set of event kinds this
     projection consumes; events outside the set MUST be no-ops (not errors).
   - `outOfScopeKinds: ReadonlyArray<RunEventKind>` — explicitly listed; all kinds NOT
     in `inputKinds` MUST appear here. The package exports a type-level helper that
     verifies `inputKinds ∪ outOfScopeKinds = AllKinds` so adding a new kind in the
     future forces an explicit decision per projection.
   - **NO `reduce` function** in S1. Reducer implementations belong to S3.

   Per-projection view shapes:

   - `TaskProjectionView.view`: `{ tasks: Record<TaskId, { title, ownerActor, state, dependsOn[], history: Array<{from, to, eventId}> }> }`
   - `MailboxProjectionView.view`: `{ messages: Array<{ messageId, fromActor, toActor, kind, body, sequence, eventId }> }` — chronologically ordered by `sequence`.
   - `EvidenceProjectionView.view`: `{ run: { runId, status, startedAt, completedAt, summary } | null, citations: Array<{ eventId, sequence, kind, summary: string }> }`.

   `FinalReportProjectionView` is **deferred** (out of scope for S1; reconsidered at
   S3 if the legacy fixtures show it cannot be derived from the three above).

6. **Replay-fixture format (declarative type only).**

   At `packages/pluto-v2-core/src/replay-fixture.ts`, define:

   ```ts
   type ReplayFixture = {
     name: string;
     description: string;
     schemaVersion: string;
     events: RunEvent[];
     expectedViews: {
       task?: TaskProjectionView['view'];
       mailbox?: MailboxProjectionView['view'];
       evidence?: EvidenceProjectionView['view'];
     };
   };
   ```

   At `packages/pluto-v2-core/test-fixtures/replay/<scenario>.json`, ship at least one
   small (≤ 20 events) hand-written fixture validating that the schema parses an
   end-to-end run.

   The replay **acceptance rules** are documented in
   `docs/design-docs/v2-contracts.md`:

   - Reducer idempotency: applying the same fixture twice produces identical view state.
   - Reducer purity: reducers are total over their `inputKinds` and depend only on the
     event sequence and the current view.
   - Forward compatibility: kinds outside `inputKinds` are ignored (no errors).
   - Deterministic serialization: views serialize via a stable strategy (e.g. sorted
     object keys + ascending sequence) so fixture comparisons are exact.

   These rules are constraints S3 must satisfy; S1 only states them.

7. **Versioning policy.**

   - `schemaVersion` is `"<major>.<minor>"` as a string (e.g. `"1.0"`).
   - Initial value: `"1.0"`.
   - **Within the same major: ONLY additive *optional fields* are allowed.** Adding
     a new `kind`, `intent`, `RejectionReason`, `ActorRef.role`, or `EntityRef.kind`
     is an enum addition and **requires a major version bump** — closed enums in v2
     are part of the strict-validation surface.
   - Existing required fields stay required and keep their types within the same
     major. Existing optional fields stay optional with the same type.
   - Schemas use zod's default `.strip()` semantics at the top level: an event with
     extra unknown fields parses successfully, and unknown fields are silently
     dropped. This is what guarantees forward-compat for **field additions** within a
     major: a v1.1 event carrying an extra optional field parses cleanly under the
     v1.0 schema (the field is dropped).
   - Discriminator fields (`kind`, `intent`, `outcome`) are validated against the
     v1.0 closed enum. If a future v1.x event carries a discriminator value not in
     the v1.0 enum, parse fails — this is the contract that prevents enum drift
     within a major.
   - Major bump (`"2.0"`): allowed to remove fields, change types, change enum
     membership, or change discriminator semantics. Major bumps MUST ship a
     programmatic migrator from the prior major; the migrator is part of the
     package and is invoked explicitly on input that declares a different major.
   - Fixture compatibility expectation: a fixture written today with `schemaVersion =
     "1.0"` MUST parse successfully against any future `"1.x"` schema **as long as
     the fixture only uses v1.0 enum values**. New v1.x optional fields appearing in
     newer fixtures parse under v1.0 by being dropped via `.strip()`. New v1.x enum
     members do NOT exist by definition — they require a major bump.

   This resolves the apparent tension between "closed schema rejects anything else"
   and "future v1.x events parse against v1.0": rejection applies to *structural and
   enum-discriminator* violations, while `.strip()` allows unknown *optional fields*.

8. **Packaging & build.** ESM only, strict TypeScript, zero runtime deps beyond `zod`.
   The package compiles via `tsc --build` invoked through the workspace; root
   `pnpm-workspace.yaml` declares only `packages/pluto-v2-core`; root `.gitignore` adds
   an explicit allow-list exception (`!packages/pluto-v2-core/` and
   `!packages/pluto-v2-core/**`) so the new package is tracked even though `packages/`
   is otherwise ignored.

9. **Tests (S1 scope).**

   The test contract has two distinct categories of negative tests; do not conflate:

   - **Taxonomy-reachability tests** (parse-success): for each of the six
     `RejectionReason` values, construct a valid `request_rejected` event with that
     reason in the payload and assert `RunEventSchema.parse` succeeds. This proves
     the rejected-event payload's `rejectionReason` field accepts every closed
     taxonomy member; it does NOT prove authority logic.
   - **Schema-rejection tests** (parse-failure): for each closed enum, construct an
     input that violates the closure or drops a required field, and assert
     `RunEventSchema.parse` (or `ProtocolRequestSchema.parse`) throws.

   Concrete test files:

   - `__tests__/run-event.test.ts`: happy-path parse + round-trip per accepted kind
     (six tests, one per accepted `kind`). Each test uses the per-kind payload
     listed in deliverable 2.
   - `__tests__/run-event-rejected.test.ts`: six taxonomy-reachability tests —
     parse-success of valid `request_rejected` events, one per `RejectionReason`.
   - `__tests__/run-event-schema-rejection.test.ts`: schema-rejection tests
     constructing structurally invalid input and asserting parse failure:
     - drop a required field on an accepted event (covers `schema_invalid` proxy);
     - set `actor.kind: 'role'` with `role` outside the closed four-role set
       (covers `actor_not_authorized` schema proxy);
     - set `entityRef.kind: 'approval'` (covers `entity_unknown` schema proxy via
       EntityRef closure);
     - set `outcome: 'rejected'` with `kind` other than `'request_rejected'`
       (discriminator closure);
     - set `kind: 'approval_emitted'` on an accepted event (RunEvent.kind
       closure);
     - set `payload.rejectionReason: 'budget_exceeded'` on a `request_rejected`
       event (RejectionReason closure).
   - `__tests__/protocol-request.test.ts`: happy-path parse per intent (five tests)
     + parse-failure when `intent` is outside the closed enum (`intent_unknown`
     schema proxy) + parse-failure when a required field is missing
     (`schema_invalid`).
   - `__tests__/projection-contracts.test.ts`: type-level checks (compile-time
     `expect<T extends ...>`) confirming that `inputKinds ∪ outOfScopeKinds =
     AllKinds` for each projection AND that `inputKinds ∩ outOfScopeKinds = ∅`.
     NO reducer tests in S1.
   - `__tests__/replay-fixture.test.ts`: one fixture loads, parses against
     `RunEventSchema`, and the `expectedViews` shapes parse against their respective
     view shapes. NO reducer execution.
   - `__tests__/versioning.test.ts`:
     - a future-`"1.x"` event with one extra **optional field** (e.g. an unknown
       payload field added under a known `kind`) parses successfully against the
       v1.0 schema (the unknown field is stripped by `.strip()`);
     - a future-`"1.x"` event with a new **enum value** (a new `kind`) is rejected
       at parse time (closed enum proves this);
     - a `"2.0"` event whose schemaVersion declares a different major is rejected
       unless explicitly fed through a migrator (the migrator is not part of v1.0,
       so the test asserts rejection in the absence of a migrator).

10. **Docs.**

    - `packages/pluto-v2-core/README.md` — public surface enumeration; explicitly states
      "no executable reducers; those live in S3".
    - `docs/design-docs/v2-contracts.md` — narrative covering: contract goals,
      RunEvent envelope, kind/payload union, ActorRef and EntityRef closure rationale,
      ProtocolRequest intent set and request→event mapping table, RejectionReason
      taxonomy with one example per reason, projection-as-contract rules, replay
      acceptance rules (rephrased from deliverable 6), versioning policy, evidence
      surface coverage table (which legacy `.pluto/runs/<runId>/*` files are derivable
      from which projections; mark `final-report.md`, `status.md`, `task-tree.md`,
      `workspace-materialization.json`, `runtime-helper-usage.jsonl`, and inbox mirrors
      as **deferred to later slices** — they are NOT in scope for S1).

### Out of scope for S1 (explicit)

- Runtime, kernel, executable reducer, or replay-machinery code.
- `FinalReportProjectionView` (deferred to S3 evaluation; not in v1.0 contract surface).
- `approval` / `publish-package` / `schedule` / RBAC / tenancy as `EntityRef` kinds.
- v1.6 file-lineage edits (mailbox/task/evidence file dual-writes).
- Adapter, CLI, and runtime-helper concepts as contract-level types.
- Migrators from the legacy fixtures to v2; legacy fixtures are oracles, not inputs.
- Backwards-compat shims to v1.6 imports.

### Bundle-vs-repo-diff scope

`tasks/remote/<task_id>/` files are orchestration **bundle artifacts**, not part of the
S1 implementation diff. Remote leaves may add to `tasks/remote/<task_id>/artifacts/` but
must not ship those changes in the S1 branch's main diff. The S1 branch's diff against
`main` MUST contain only the allow-listed paths in the diff hygiene rule below.

### Why S1 must remain declarative (anchor)

The handoff's Phase split says: Phase 1 = "Define before implementation" (contracts);
Phase 3 = "Projections and replay" (executable reducers + replay tests). Mixing
executable reducer behavior into S1 violates the slice table and the handoff. Concrete
projection logic and replay tests are S3's responsibility; S1 only fixes the rules they
must obey.

### S1 dependency graph

S1 has no upstream blockers. Downstream: S2 imports the schemas; S3 implements the
reducers and replay tests against the rules in deliverable 6.

### S1 acceptance bar

- **Package-scoped typecheck:** `pnpm --filter @pluto/v2-core typecheck` clean. The
  new package's local `typecheck` script is `tsc -p tsconfig.json --noEmit` (or
  equivalent). The S1 acceptance does NOT require the root-scoped `pnpm typecheck`
  to cover the new package — root-script coverage of the new package is wired in
  later slices once the v2 surface stabilizes.
- **Package-scoped vitest:** `pnpm --filter @pluto/v2-core exec vitest run` (or
  `pnpm exec vitest run packages/pluto-v2-core`) green and finishes under 60 s.
- **Package-scoped build:** `pnpm --filter @pluto/v2-core build` clean. The new
  package's local `build` script is `tsc -p tsconfig.json` (or `--build`,
  whichever the package adopts).
- **Root-scoped full suite (regression gate):** `pnpm test` green (one full-suite
  run only, at slice end; R7). The full suite must continue to pass; the new
  package's tests are picked up only if root scripts include them, so a clean
  `pnpm test` here just confirms the legacy v1.6 surface is unaffected.
- `RunEvent` is a single zod discriminated union over the closed kind set; every
  rejection reason has a dedicated taxonomy-reachability test (parse-success) AND
  a schema-rejection test (parse-failure) where applicable; every projection
  contract declares `inputKinds` AND `outOfScopeKinds` covering all kinds;
  `EntityRef` includes only the four listed kinds (no `approval`); `ActorRef.role`
  is the closed four-role set; no exported type or schema mentions Paseo, OpenCode,
  helper CLI paths, role-bound helper paths, adapter sessions, or active hooks
  runtime.
- `versioning.test.ts` proves the additive-optional-field forward-compat rule AND
  the closed-enum reject-on-new-kind rule.
- A reviewer sub-agent confirms (a) the contract surface matches deliverables 2..7,
  (b) no executable reducer or replay machinery is shipped in S1, and (c) no out-of-scope
  surfaces (approval / publish-package / schedule / RBAC) leak in.
- Diff hygiene: edits limited to:
  - `packages/pluto-v2-core/**`,
  - `docs/design-docs/v2-contracts.md`,
  - the `S1` row of `docs/plans/active/v2-rewrite.md`'s Status tracker,
  - root `pnpm-workspace.yaml` (created if missing; declares only the new package),
  - root `.gitignore` (allow-list exception for the new package only),
  - root `tsconfig.json` / `tsconfig.build.json` (only `references` additions if
    needed for the new package to compile),
  - **root `pnpm-lock.yaml`** (regenerated by `pnpm install` to reflect the new
    package's deps; do NOT manually edit; do NOT alter unrelated entries),
  - **root `package.json`** (additive only; permitted to add narrow workspace-scoped
    scripts like `"typecheck:v2": "pnpm --filter @pluto/v2-core typecheck"` and
    `"build:v2": "pnpm --filter @pluto/v2-core build"` for convenience; do NOT
    change existing scripts, dependencies, `packageManager` field, or unrelated
    fields).
  - No edits to `src/`, `tests/`, `evals/`, `docker/`, `docs/plans/active/*` (other
    than the S1 row), `docs/exec-plans/*` (no such dir), `playbooks/`, `scenarios/`,
    `run-profiles/`, or any v1.6 contract file.

### Bootstrap policy

The S1 bootstrap MUST use `pnpm install` (without `--frozen-lockfile`). Adding a
new workspace package legitimately stales the lockfile; allowing the install to
regenerate it is the correct path. CI / future repeated runs may add
`--frozen-lockfile` back once the lockfile is stable.

## S2 — Phase 2: Pure core (next slice)

### Outcome

Implement the pure event-sourced core under `packages/pluto-v2-core/src/core/`,
using only the schemas published by S1. The core accepts `ProtocolRequest`
inputs, performs authority + schema validation, and produces `RunEvent`s
(accepted or rejected) plus an updated `RunState`. **No projections, no replay
machinery, no runtime adapter, no CLI, no I/O.** S3 owns projections; S4 owns
runtime adapter wiring.

### Concrete deliverables

1. **Module layout under `packages/pluto-v2-core/src/core/`** (extends the
   existing S1 package; do NOT introduce a new package):
   - `core/spec-compiler.ts` — compiles a four-layer spec (Agent / Playbook /
     Scenario / RunProfile authored objects) into a `TeamContext` value
     consumed by the kernel. Loads the four-layer YAML / JSON authored
     content; emits typed compile errors as a closed taxonomy.
   - `core/team-context.ts` — `TeamContext` zod schema + types. Closed shape
     covering: `runId`, `scenarioRef`, `runProfileRef`, declared `actors`
     (closed ActorRef set for this run), `tasks` initial spec (optional),
     `policies` (authority rules — see deliverable 4).
   - `core/run-state.ts` — `RunState` zod schema + types. The current
     in-memory projection of the event log, used **only** by the kernel for
     authority validation; consumers use S3 projections, not `RunState`. Fields
     include: `runId`, `sequence`, `status`, `tasks` (`Record<TaskId, TaskState>`
     with state machine), `mailbox` (small head-only summary for idempotency
     checking), `acceptedRequestKeys` (`Set<idempotencyKey>` for
     `idempotency_replay` detection), `actors` (allowed ActorRef set).
   - `core/run-state-reducer.ts` — pure `reduce(state, event): RunState`
     function. Consumes only `RunEvent` (any kind, accepted or rejected).
     Idempotent under replay. Total over the closed kind set; throws on
     unexpected kind only as a defensive assertion.
   - `core/run-event-log.ts` — append-only log abstraction with strict
     monotonic `sequence` and an `appendOnly` invariant. Pluggable backing
     store interface (`EventLogStore`); ships an in-memory implementation
     for unit tests. NO file/database I/O. The kernel uses `EventLogStore`
     to commit events and re-derive `RunState`.
   - `core/protocol-validator.ts` — pure `validate(state, request, ctx):
     ValidationResult`. Performs schema validation (already covered by
     `ProtocolRequestSchema.parse`) plus the authority checks below.
     Returns `{ ok: true, accept: AcceptedDecision } | { ok: false,
     reject: RejectionReason, detail }`.
   - `core/authority.ts` — closed authority predicates:
     - `actorAuthorizedForIntent(actor, intent)` — maps each
       `ProtocolRequest.intent` to the closed set of `ActorRef.kind` /
       `role` allowed to issue it.
     - `entityResolvable(state, request)` — confirms task/mailbox/artifact
       refs in the payload exist in `RunState`.
     - `transitionLegal(state, request)` — for `change_task_state`, enforces
       the closed task-state transition graph (`queued → running → completed
       | blocked | failed`; `running → blocked → running`; `* → cancelled`;
       NO arbitrary transitions).
     - `idempotencyClear(state, request)` — `(runId, actor, intent,
       idempotencyKey)` not yet in `acceptedRequestKeys`.
     - The S2 design doc fixes the closed authority matrix (which intent
       requires which role); see deliverable 7.
   - `core/run-kernel.ts` — single entry point.
     `RunKernel.submit(request): { event: RunEvent }` — synchronous, pure
     except for the side-effecting append-to-log. Steps: schema parse →
     `protocol-validator.validate` → if accepted, construct accepted
     `RunEvent` with server-assigned fields; if rejected, construct
     `request_rejected` event. Append to log. Update `RunState`. Return
     event.
   - `core/index.ts` — re-exports the public core surface.

2. **Authority matrix (binding for S2).**

   For each `ProtocolRequest.intent`, list the closed `ActorRef.kind` /
   `role` set authorized to issue it:

   | intent | allowed actors |
   |---|---|
   | `append_mailbox_message` | manager, role=lead, role=planner, role=generator, role=evaluator |
   | `create_task` | role=lead, role=planner |
   | `change_task_state` | role=lead, role=generator, role=evaluator (each only for tasks they own); manager (any task) |
   | `publish_artifact` | role=generator (intermediate + final), role=lead (final) |
   | `complete_run` | manager only |

   The mapping is encoded in `core/authority.ts` as a closed table, NOT
   open-ended policy. Roles are checked via `ActorRef.role`; manager via
   `ActorRef.kind === 'manager'`.

3. **Task-state transition graph (binding).**

   Closed graph encoded in `core/authority.ts`:

   ```
   queued    → running, cancelled
   running   → completed, blocked, failed, cancelled
   blocked   → running, cancelled
   completed → (terminal)
   failed    → (terminal)
   cancelled → (terminal)
   ```

   Any transition outside this graph is `state_conflict`.

4. **Pure-core invariants (encoded in tests).**

   - **Determinism**: same `(initial state, request sequence) → same event
     sequence`.
   - **Idempotency under replay**: replaying the kernel's emitted event
     stream through `run-state-reducer.reduce` from genesis yields the same
     final `RunState`.
   - **No I/O**: `core/**` MUST NOT import `node:fs`, `node:path`, `node:net`,
     any HTTP/WS client, or anything outside the package itself. The
     `EventLogStore` interface is the only abstraction-of-side-effect
     boundary, and the in-memory implementation MUST be pure.
   - **No runtime concepts**: no Paseo, no OpenCode, no helper-CLI, no
     adapter, no CLI strings — same no-runtime-leak grep as S1, applied to
     `core/**`.

5. **Tests.**

   Under `packages/pluto-v2-core/__tests__/core/`:

   - `__tests__/core/spec-compiler.test.ts` — happy-path compile +
     compile-error taxonomy (`unknown_actor`, `duplicate_task`,
     `policy_invalid`, etc.; closed enum).
   - `__tests__/core/run-state-reducer.test.ts` — reducer purity tests:
     reduce twice = same state; reducer is total over the closed kind set.
   - `__tests__/core/run-event-log.test.ts` — in-memory log append-only,
     monotonic sequence, replay yields same events.
   - `__tests__/core/protocol-validator.test.ts` — one parse-success +
     authority-accept per intent (5); one rejection test per
     `RejectionReason` (6). Tests use canonical fixture states
     (re-using `test-fixtures/replay/basic-run.json` where applicable).
   - `__tests__/core/authority.test.ts` — authority matrix table-driven
     test: every `(actor, intent)` pair in the matrix accepts; every pair
     OUTSIDE the matrix rejects with `actor_not_authorized`.
   - `__tests__/core/transition-graph.test.ts` — task-state transition
     graph table-driven: every legal transition accepts; every illegal
     transition rejects with `state_conflict`.
   - `__tests__/core/run-kernel.test.ts` — end-to-end kernel scenarios
     producing event streams that match expected snapshots; covers all 5
     intents + all 6 rejection reasons.

6. **No-runtime-leak (S2 scope).**

   Same grep as S1, applied to `packages/pluto-v2-core/src/core/**` and
   `packages/pluto-v2-core/__tests__/core/**`. Zero matches expected.

7. **Docs.**

   - Update `packages/pluto-v2-core/README.md` to add a "Pure core (S2)"
     section enumerating the new public surface.
   - Add `docs/design-docs/v2-core.md` covering: `RunKernel` flow,
     authority matrix (verbatim from deliverable 2), task-state transition
     graph (verbatim from deliverable 3), `RunState` shape rationale,
     EventLogStore interface, replay-equivalence proof sketch, what is
     intentionally absent (projections, runtime adapter, CLI).

### Out of scope for S2

- Projections (`TaskProjectionView` / `MailboxProjectionView` /
  `EvidenceProjectionView`) and replay tests against fixtures — those are S3.
- Any runtime adapter (Fake or Paseo) — S4 / S5.
- Any CLI changes — S6.
- Any v1.6 file-lineage edits.
- Persistence to disk / database / network — `EventLogStore` ships only the
  in-memory implementation in S2; durable stores arrive when needed by S4+.
- `FinalReportProjectionView` — still deferred until S3 reconsideration.

### Process improvement (binding for S2 onward)

The S1 remote run lost working-tree files between gate completion and the
self-review loop, forcing the local manager to reconstruct from
`artifacts/diff.patch`. To prevent recurrence:

- The remote root manager MUST `git add -A && git commit` AS SOON AS gate
  artifacts are written (i.e. immediately after `gate_test_suite` returns
  zero), BEFORE the self-review loop begins.
- The remote root manager MUST `git push origin <branch>` after the commit,
  so the work is durable and addressable from the local manager regardless
  of working-tree state.
- The self-review loop runs against the committed branch, not the working
  tree. The reviewer reads the diff via `git show` / `git diff main..HEAD`,
  not via uncommitted files.
- If the review loop produces fix rounds, each fix is a NEW commit on the
  branch. The branch grows; nothing is reverted in working tree.

This rule is enforced by the S2 acceptance bar's diff-hygiene check (the
branch HEAD MUST be ahead of `main` by at least one commit at acceptance
time).

### S2 dependency graph

S2 imports `@pluto/v2-core` schemas (S1) — already on `main`. S2 does NOT
depend on S3, S4, or any later slice.

### S2 acceptance bar

- **Package-scoped typecheck**: `pnpm --filter @pluto/v2-core typecheck` clean.
- **Package-scoped vitest**: `pnpm --filter @pluto/v2-core exec vitest run`
  green; the new `core/` test suite ≥ 7 files; total package test count ≥
  S1 baseline (32) + S2 additions; finishes < 90 s.
- **Package-scoped build**: `pnpm --filter @pluto/v2-core build` clean.
- **Root regression**: `pnpm test` green (single full-suite at slice end;
  R7).
- All authority predicates table-driven and prove closure over the matrix.
- Reducer purity test passes (reduce-twice equality).
- No-runtime-leak grep clean over `core/**`.
- Diff hygiene: edits limited to `packages/pluto-v2-core/src/core/**`,
  `packages/pluto-v2-core/__tests__/core/**`,
  `packages/pluto-v2-core/src/index.ts` (additive re-exports for `core/*`),
  `packages/pluto-v2-core/README.md` (additive S2 section),
  `docs/design-docs/v2-core.md` (new), and the S2 row of the Status
  tracker. NO edits to S1 schema files. NO edits to root `package.json` /
  `pnpm-workspace.yaml` / `.gitignore` / lockfile. NO edits to `src/`,
  `tests/` (root), `evals/`, `docker/`, `playbooks/`, `scenarios/`,
  `run-profiles/`, `agents/`, or any v1.6 contract file.
- **Branch must be committed and pushed**: at acceptance time, branch HEAD
  is at least one commit ahead of `main`, and the remote review loop ran
  against the committed branch (not uncommitted working-tree state).
- A reviewer sub-agent confirms (a) authority matrix membership, (b) closed
  task-state transition graph, (c) reducer purity, (d) no-I/O assertion,
  (e) no-runtime-leak.

## Discovery gate (per slice)

Before each slice is dispatched to remote implementation:

1. Send the slice scope, deliverables, acceptance bar, and authority references to a
   local OpenCode Companion session (`opencode-companion.mjs session new --background
   --agent orchestrator`).
2. The prompt explicitly asks for `@oracle` (strategic / YAGNI / risk) and `@council`
   (independent multi-perspective implementation-readiness) review.
3. Slice moves to dispatch only when the review reports "ready, no blocking gaps".
4. Discovery findings update this plan's slice section before dispatch.

## Remote dispatch contract

For each slice dispatched to the remote OpenCode manager (`paseo run --host
$HOST --provider opencode --model openai/gpt-5.4 --mode orchestrator --thinking high`):

- Remote uses sandbox `c8ef5890-f1d2-4f53-a76d-b6ec6ae38549` (snapshot
  `personal-dev-env-vps-5c10g150g`), workspace `/workspace`, host
  `$(daytona-manager preview --port 6767 ...)`.
- Implementation lives in worktrees under `/workspace/.worktrees/<task_id>/...`.
- Manager is OpenCode `openai/gpt-5.4` orchestrator mode (R4, R5).
- Implementation leaves are OpenCode Companion sessions inside the sandbox.
- Bundle layout under `tasks/remote/<task_id>/`:
  - `HANDOFF.md`
  - `context-index.md`
  - `prompt.md`
  - `env-contract.md`
  - `acceptance.md`
  - `commands.sh`
  - `artifacts/`
  - `logs/`
- Test budget per invocation ≤ 20 minutes (R7); `pnpm smoke:live` is a final gate, not a
  fix loop (R8).

## Local acceptance loop

After each slice's remote return:

1. Pull artifacts and the slice branch.
2. Local OpenCode Companion preliminary review (with `@oracle` + `@council`).
3. Address objections via remote fix rounds in the same sandbox or local fix sessions.
4. Local final checks: `pnpm typecheck`, `pnpm test`, `pnpm build`. Add `pnpm smoke:fake`
   when the slice touches the runtime path; reserve `pnpm smoke:live` for S5 / S6 only.
5. Merge into `main`, mark the slice row in this plan with the merge commit and
   evidence pointer, and move to the next slice.

## Status tracker

| Slice | State | Branch | Evidence |
|---|---|---|---|
| S0 | In progress | `main` | this plan + legacy banners |
| S1 | Done | `main` @ `c9bc46f` | `packages/pluto-v2-core/` (closed schemas, declarative projections, replay-fixture format, versioning, 7 files / 32 tests, README, design doc) — local OpenCode acceptance review READY_TO_MERGE 2026-05-07 |
| S2 | Not started | — | — |
| S3 | Not started | — | — |
| S4 | Not started | — | — |
| S5 | Not started | — | — |
| S6 | Not started | — | — |
| S7 | Not started | — | — |

## Stop conditions

Stop and re-confirm with the operator if:

- Any slice review finds the contract surface incompatible with the legacy fixtures we
  intend to replay.
- Remote sandbox is destroyed or its persistent state is lost.
- An external service or paid model not authorized in the bundle is required.
- Any agent proposes amending CLAUDE.md / operating rules / `.local/manager` workflow
  docs without an explicit operator request.
- Any agent proposes archiving / deleting v1.6 code before v2 acceptance gates pass.

## Last updated

2026-05-07 — initial draft.
