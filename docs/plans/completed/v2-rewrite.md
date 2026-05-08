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
   existing S1 package; do NOT introduce a new package).

   1.1 `core/spec-compiler.ts` — `compile(authored: AuthoredSpec): TeamContext`.
   Consumes **already-parsed** authored objects (Agent / Playbook / Scenario /
   RunProfile shaped TypeScript values); does NOT read YAML/JSON files itself.
   YAML/JSON file loading is the runtime adapter's job (S4+). This keeps core
   pure and no-I/O. Emits typed compile errors as a closed taxonomy:
   `unknown_actor`, `duplicate_task`, `policy_invalid`, `intent_payload_mismatch`,
   `actor_role_unknown`. `AuthoredSpec` is a zod-validated input type defined
   alongside `TeamContext`.

   1.2 `core/team-context.ts` — `TeamContext` zod schema + types. Closed shape:
   `runId`, `scenarioRef`, `runProfileRef`, `declaredActors: ActorRef[]` (the
   closed set of actors authorized to participate in this run; subset of the
   global `ActorRef` union), `initialTasks: Array<{taskId, title, ownerActor,
   dependsOn[]}>` (optional), `policy: AuthorityPolicy` (the matrix from
   deliverable 2; same shape across all runs at v1.0 — runtime cannot widen
   it).

   1.3 `core/run-state.ts` — `RunState` zod schema + types. **Authority-internal
   only**. The kernel's minimum-shape view used solely to validate the next
   request. Closed shape:
   - `runId: string`
   - `sequence: number` — highest applied event sequence; `-1` before the run
     starts.
   - `status: 'initialized' | 'running' | 'completed' | 'failed' | 'cancelled'`
   - `tasks: Record<TaskId, { state: TaskState, ownerActor: ActorRef | null }>`
     — **only** the data authority needs for `entity_unknown` / `state_conflict`
     / ownership checks. NO `title`, NO `dependsOn`, NO state-history. Those
     reside in S3's `TaskProjectionView`.
   - `acceptedRequestKeys: Set<string>` — composite key set for idempotency.
     Each key is the canonical string `${runId}|${actorKey(actor)}|${intent}|${idempotencyKey}`
     where `actorKey` is a stable serialization of `ActorRef`. Requests with
     `idempotencyKey === null` are NEVER added to the set and never trigger
     `idempotency_replay` (null = "no dedup requested by client; treat every
     such request as fresh"). The canonical key formula is exported as
     `composeRequestKey(runId, actor, intent, idempotencyKey): string | null`
     where the function returns `null` when `idempotencyKey` is null.
   - `declaredActors: Set<string>` — `actorKey()`-stringified set of
     `TeamContext.declaredActors`; an actor not in this set fails
     `actor_not_authorized` regardless of role.

   `RunState` MUST NOT contain mailbox content, artifact lists, evidence-shaped
   data, full task histories, or anything that is the legitimate output of an
   S3 projection. The S2 acceptance bar grep-checks for these absent fields.

   1.4 `core/run-state-reducer.ts` — `reduce(state, event): RunState`.
   Pure. Total over the closed `RunEvent` kind set (six accepted +
   `request_rejected`). Each kind's reducer is a small switch arm. The reducer
   updates: `sequence` (always advances by exactly 1), `status` (run_started
   → running; run_completed → status from payload), `tasks` (task_created
   inserts; task_state_changed updates state), and `acceptedRequestKeys` (every
   accepted event adds its composite key if `requestId !== null` and the request
   carried a non-null `idempotencyKey`). For `request_rejected` and unrecognized
   future kinds the reducer is a **no-op except for `sequence` advance**;
   schema rejects unknown kinds at parse time, so the reducer never sees them.
   The reducer NEVER throws; defensive assertions are explicit `assert` calls
   that are removed by the build for releases (or behind a `// istanbul ignore`).

   1.5 `core/run-event-log.ts` — pluggable `EventLogStore` interface + in-memory
   implementation `InMemoryEventLogStore`. Interface (binding):

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

   Sequence is assigned by the **kernel** (deliverable 1.7), not the store; the
   store enforces monotonicity by checking `event.sequence === head + 1` on
   append. Duplicate `eventId` (same uuid in two different events) throws
   `DuplicateAppendError`. Replay is `read(0, head + 1)`. No file / DB / network
   I/O. S4+ may add a durable implementation behind the same interface.

   1.6 `core/protocol-validator.ts` — `validate(state, request, ctx):
   ValidationResult`. Pure. Two-stage:
   - **Stage 1: schema parse.** Already done by `ProtocolRequestSchema.parse`
     (S1). If the input never parsed, the kernel never calls `validate`; see
     deliverable 1.7 for malformed-input handling.
   - **Stage 2: authority checks** in this fixed precedence (first failure
     wins):
     1. `actor_not_authorized` — actor not in `state.declaredActors` OR not
        in the matrix row for `request.intent`.
     2. `entity_unknown` — payload references task / artifact / mailbox-message
        ids not in `state.tasks` etc., OR (for `change_task_state`) `from`
        does not match the current task state, OR `dependsOn` references an
        unknown task.
     3. `state_conflict` — for `change_task_state`, the (from, to) transition
        is not in the closed graph (deliverable 3).
     4. `idempotency_replay` — `composeRequestKey(state.runId, request.actor,
        request.intent, request.idempotencyKey)` is non-null AND already in
        `state.acceptedRequestKeys`.

   Returns `{ ok: true } | { ok: false, reason: RejectionReason, detail: string }`.

   1.7 `core/run-kernel.ts` — `RunKernel.submit(rawRequest: unknown): {
   event: RunEvent }`. Single synchronous entry point. Steps:
   1. Schema parse `rawRequest` via `ProtocolRequestSchema.parse`. On parse
      failure: emit `request_rejected` with `rejectionReason: 'schema_invalid'`
      and `rejectedRequestId: extractRequestIdSafely(rawRequest) ?? '<unknown>'`,
      `detail: <zod issues summary>`. Append + reduce + return.
   2. Call `protocol-validator.validate(state, request)`.
   3. If accepted: construct accepted `RunEvent` with kernel-assigned envelope
      fields (`eventId = idProvider.next()`, `sequence = state.sequence + 1`,
      `timestamp = clockProvider.nowIso()`, `requestId = request.requestId`,
      `causationId = state.lastEventId ?? null`, `correlationId =
      ctx.correlationId ?? null`, `actor = request.actor`, `entityRef = ...
      derived from intent's payload`, `outcome: 'accepted'`, `kind` per the
      intent→event mapping in S1, `payload` derived from request payload plus
      server-assigned ids from `idProvider.next()` for new `messageId` /
      `taskId` / `artifactId`).
   4. If rejected: construct `request_rejected` event with the rejection reason
      and detail.
   5. `eventLog.append(event)`.
   6. `state = reducer.reduce(state, event)`.
   7. Return `{ event }`.

   The kernel takes injected `idProvider: { next: () => string }` and
   `clockProvider: { nowIso: () => string }` as constructor params. Default
   providers (using `crypto.randomUUID()` and `new Date().toISOString()`) are
   exported from `core/providers.ts` BUT marked deprecated for tests; tests
   MUST inject deterministic providers (counter-based UUID, fixed-Date clock).
   `core/**` files OTHER than `core/providers.ts` MUST NOT call
   `crypto.randomUUID()` or `new Date()` directly; this is enforced by a
   no-ambient-randomness grep in the S2 acceptance bar.

   1.8 `core/index.ts` — re-exports the public core surface.

2. **Authority matrix (binding for S2; major-bump to change).**

   Authority matrix membership is part of the closed v1.0 contract surface:
   per S1 versioning policy, ANY change to which `(actor, intent)` pairs
   accept is a major-version bump. Documented in `core/authority.ts` and
   the S2 design doc.

   | intent | allowed actors |
   |---|---|
   | `append_mailbox_message` | `kind: 'manager'`, `role: 'lead'`, `role: 'planner'`, `role: 'generator'`, `role: 'evaluator'`, `kind: 'system'` |
   | `create_task` | `kind: 'manager'`, `role: 'lead'`, `role: 'planner'` |
   | `change_task_state` | `kind: 'manager'` (any task); `role: 'lead'` (any task); `role: 'generator'` / `role: 'evaluator'` only for tasks where `state.tasks[taskId].ownerActor` matches the requesting actor; `role: 'planner'` only for `to: 'cancelled'` and `to: 'blocked'` (replanning hooks) |
   | `publish_artifact` | `role: 'generator'` (any artifact); `role: 'lead'` (any artifact); `kind: 'manager'` (any artifact) |
   | `complete_run` | `kind: 'manager'` |

   Null-owner behavior: if `state.tasks[taskId].ownerActor === null`,
   `change_task_state` is allowed for `kind: 'manager'` and `role: 'lead'`
   only; other actors fail `actor_not_authorized`.

   `kind: 'system'` events (e.g. `run_started`) are emitted directly by the
   kernel WITHOUT going through `submit`; they do not appear in the matrix.

   The matrix is encoded in `core/authority.ts` as a constant `AUTHORITY_MATRIX:
   Readonly<Record<Intent, ReadonlyArray<ActorMatcher>>>` where `ActorMatcher`
   is a closed union: `{ kind: 'manager' } | { kind: 'role'; role: Role } |
   { kind: 'system' } | { kind: 'role-owns-task'; role: Role } | { kind:
   'role-bounded-transitions'; role: Role; transitions: Array<TaskState> }`.
   Tests cover every (actor, intent) pair both inside and outside the matrix.

3. **Task-state transition graph (binding; major-bump to change).**

   Closed graph encoded in `core/authority.ts`:

   ```
   queued    → running, blocked, completed, failed, cancelled
   running   → completed, blocked, failed, cancelled
   blocked   → running, completed, failed, cancelled
   completed → (terminal — no outgoing)
   failed    → (terminal — no outgoing)
   cancelled → (terminal — no outgoing)
   ```

   `queued → completed` is permitted (covers instant-completion tasks per
   `test-fixtures/replay/basic-run.json`). Terminals are absolute: once a
   task reaches `completed`, `failed`, or `cancelled`, no further
   `change_task_state` is legal.

   Any transition outside this graph is `state_conflict`. The graph is
   encoded as a constant `TRANSITION_GRAPH: Readonly<Record<TaskState,
   ReadonlyArray<TaskState>>>` and tested table-driven over all 6×6 = 36
   pairs.

4. **Pure-core invariants (encoded in tests + acceptance grep).**

   - **Determinism with injected providers.** The kernel takes
     `idProvider` and `clockProvider`. Tests inject deterministic
     providers (counter-based UUIDs, fixed clock) so `(initial state,
     request sequence) → same event sequence` holds exactly.
   - **No ambient randomness/time in core.** Everywhere under `core/**`
     other than `core/providers.ts`, `crypto.randomUUID`, `Math.random`,
     `Date.now`, `new Date()`, `performance.now()` are FORBIDDEN. The
     S2 acceptance bar greps for these patterns and fails on any match.
   - **Idempotency under replay.** Replaying `eventLog.read(0, head+1)`
     through `run-state-reducer.reduce` from `initialState(teamContext)`
     yields the same final `RunState` as the live kernel produced.
   - **No I/O.** `core/**` MUST NOT import `node:fs`, `node:path`,
     `node:net`, `node:http`, `node:https`, `node:child_process`,
     `node:worker_threads`, `node:dgram`, `node:dns`, `node:tls`, any
     HTTP/WS client, or anything outside the package itself. The
     `EventLogStore` interface is the only abstraction-of-side-effect
     boundary, and `InMemoryEventLogStore` MUST be pure.
   - **No runtime concepts.** No Paseo, no OpenCode, no helper-CLI, no
     adapter, no CLI strings — same no-runtime-leak grep as S1, applied
     to `core/**`.
   - **`RunState` minimality.** Acceptance grep verifies `core/run-state.ts`
     does NOT contain the strings `history`, `body:`, `messages:`,
     `artifacts:`, `evidence`, `summary` (anywhere outside type
     references like `RunStateField` or doc comments). Those shapes are
     S3's territory.

5. **Tests.**

   Under `packages/pluto-v2-core/__tests__/core/`:

   - `__tests__/core/spec-compiler.test.ts` — happy-path compile per
     well-formed `AuthoredSpec`; one negative test per closed compile-error
     (`unknown_actor`, `duplicate_task`, `policy_invalid`,
     `intent_payload_mismatch`, `actor_role_unknown`).
   - `__tests__/core/run-state-reducer.test.ts` — reducer purity:
     `reduce(reduce(s, e), e)` MUST equal `reduce(s, e)` for an idempotent
     event sequence (replay equality); table-driven over each kind.
   - `__tests__/core/run-event-log.test.ts` — `InMemoryEventLogStore`
     append+read+monotonic-sequence; `SequenceGapError` on out-of-order
     append; `DuplicateAppendError` on duplicate eventId; `read(from, to)`
     bounds; `replay` equality.
   - `__tests__/core/protocol-validator.test.ts` — one accept test per
     intent (5); one reject test per `RejectionReason` (6); rejection
     precedence: a request that violates BOTH `actor_not_authorized` and
     `state_conflict` returns `actor_not_authorized` (precedence 1 < 3).
   - `__tests__/core/authority.test.ts` — authority matrix table-driven:
     every `(actor, intent)` pair in the matrix accepts; every pair
     OUTSIDE the matrix rejects with `actor_not_authorized`. Includes the
     `role-owns-task` matchers (test with matching + non-matching owner).
   - `__tests__/core/transition-graph.test.ts` — full 6×6 = 36 table-driven
     coverage: legal transitions accept (matched against the constant);
     illegal transitions reject with `state_conflict`; terminals reject ALL
     outgoing transitions.
   - `__tests__/core/run-kernel.test.ts` — end-to-end kernel scenarios with
     deterministic `idProvider` (counter UUID) + `clockProvider` (fixed
     ISO). Includes:
     - basic-run replay: kernel applied to the request sequence implied by
       `test-fixtures/replay/basic-run.json` produces the SAME events the
       fixture records (modulo ids assigned by counter providers; tests
       compare sequences, kinds, payloads, and actor / outcome).
     - one rejection scenario per `RejectionReason` (6 sub-tests).
     - malformed-input scenario: kernel.submit({garbage}) returns
       `request_rejected` with `schema_invalid` and continues to accept
       subsequent valid requests.

   Total S2 test count target: ≥ 35 across the 7 files (final exact count
   is up to the implementer; the acceptance bar checks ≥ 35).

6. **No-runtime-leak + no-ambient-randomness (S2 scope).**

   - Same no-runtime-leak grep as S1, applied to
     `packages/pluto-v2-core/src/core/**` and
     `packages/pluto-v2-core/__tests__/core/**`. Zero matches expected
     (design doc narrative references are still allowed).
   - **Additional grep**: `packages/pluto-v2-core/src/core/**` MUST NOT
     contain `crypto\.randomUUID|Math\.random|Date\.now|new Date\(|performance\.now`
     OUTSIDE `core/providers.ts`. Test files MAY use them only inside
     deterministic-provider helpers; the grep allows
     `__tests__/core/**/*` to use them but the assertion failure rate must
     be zero in production code paths.

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

- The remote bundle's `commands.sh` MUST include a `commit_and_push` step
  that runs `git add -A && git commit -m "<slice>: <gate-artifact-pointer>"
  && git push origin <branch>` and writes the resulting commit SHA + remote
  ref to `artifacts/branch-pushed-sha.txt`.
- The remote root manager MUST run `commit_and_push` AS SOON AS gate
  artifacts are written (i.e. immediately after `gate_test_suite` returns
  zero), BEFORE the self-review loop begins.
- The self-review loop runs against the **committed and pushed** branch,
  not the working tree. The reviewer reads the diff via `git show` /
  `git diff main..HEAD`, not via uncommitted files.
- Each fix round is a NEW commit + a fresh `commit_and_push`. The branch
  grows monotonically; nothing is reverted in working tree.
- Acceptance time: the local manager verifies that
  `git rev-parse origin/<branch>` equals the SHA recorded in
  `artifacts/branch-pushed-sha.txt`, AND that `git status --porcelain`
  inside the integration worktree is empty. If either check fails, the
  slice is BLOCKED until resolved.

This rule is enforced by the S2 acceptance bar's diff-hygiene check
described below.

### S2 dependency graph

S2 imports `@pluto/v2-core` schemas (S1) — already on `main`. S2 does NOT
depend on S3, S4, or any later slice.

### S2 acceptance bar

- **Package-scoped typecheck**: `pnpm --filter @pluto/v2-core typecheck` clean.
- **Package-scoped vitest**: `pnpm --filter @pluto/v2-core exec vitest run`
  green; the new `core/` test suite ≥ 7 files; package test count ≥ S1
  baseline (32) + 35 S2 additions; finishes < 90 s.
- **Package-scoped build**: `pnpm --filter @pluto/v2-core build` clean.
- **Root regression**: `pnpm test` green (single full-suite at slice end; R7).
- **Authority closure**: every (actor, intent) pair in the matrix accepts;
  every pair OUTSIDE the matrix rejects with `actor_not_authorized`.
- **Transition closure**: full 6×6 grid covered; legal cells accept, illegal
  cells reject with `state_conflict`.
- **Reducer purity**: replay-equality test passes.
- **Idempotency closure**: composite key `(runId, actor, intent,
  idempotencyKey)` test passes; null-key behavior test (no dedup) passes.
- **Determinism**: end-to-end kernel test using counter+fixed-clock providers
  produces byte-equal event streams across two runs.
- **No-I/O grep**: `core/**` does not import any `node:*` I/O module other
  than the type-level deps already in S1.
- **No-runtime-leak grep**: clean over `core/**` source + tests.
- **No-ambient-randomness grep**: `core/**` outside `core/providers.ts`
  contains zero matches for `crypto\.randomUUID|Math\.random|Date\.now|new Date\(|performance\.now`.
- **`RunState` minimality grep**: `core/run-state.ts` does not contain
  `history`, `body:`, `messages:`, `artifacts:`, `evidence`, `summary`
  outside doc comments.
- **basic-run fixture compatibility**: `run-kernel.test.ts` includes a
  scenario that drives the kernel with the request sequence implied by
  `test-fixtures/replay/basic-run.json` and asserts the output event stream
  matches the fixture's `events` array (sequence, kind, outcome, actor,
  payload — eventId/timestamp may differ because counter providers).
- **Diff hygiene**: edits limited to:
  - `packages/pluto-v2-core/src/core/**`,
  - `packages/pluto-v2-core/__tests__/core/**`,
  - `packages/pluto-v2-core/src/index.ts` (additive re-exports),
  - `packages/pluto-v2-core/README.md` (additive S2 section),
  - `docs/design-docs/v2-core.md` (new),
  - `docs/plans/active/v2-rewrite.md` — S2 status row only.
  - **NO edits** to S1 schema files (`run-event.ts`, `protocol-request.ts`,
    `authority-outcome.ts`, `actor-ref.ts`, `entity-ref.ts`, `projections.ts`,
    `replay-fixture.ts`, `versioning.ts`, S1 test files, S1 fixture).
  - **NO edits** to root `package.json` / `pnpm-workspace.yaml` /
    `.gitignore` / `pnpm-lock.yaml`.
  - **NO edits** to `src/`, `tests/` (root), `evals/`, `docker/`,
    `playbooks/`, `scenarios/`, `run-profiles/`, `agents/`, or any v1.6
    contract file.
- **Branch is committed AND pushed**: at acceptance time,
  `git rev-parse origin/<branch>` equals the SHA recorded in
  `artifacts/branch-pushed-sha.txt`; `git status --porcelain` in the
  integration worktree is empty; `git log main..origin/<branch>` is
  non-empty.
- A reviewer sub-agent confirms (a) authority matrix membership matches
  deliverable 2 verbatim, (b) transition graph matches deliverable 3
  verbatim, (c) reducer purity test exists and passes, (d) no-I/O grep
  passes, (e) no-runtime-leak grep passes, (f) no-ambient-randomness
  grep passes, (g) `RunState` minimality grep passes, (h) basic-run
  fixture compatibility test exists and passes.

## S3 — Phase 3: Projections + replay (next slice)

### Outcome

Implement **executable projection reducers** (Task / Mailbox / Evidence) that
satisfy the S1 declarative projection contracts, plus **replay machinery** that
folds a `RunEvent[]` into projection views. Add **replay tests** over the S1
hand-written fixture and any additional synthetic fixtures needed for closure.
S3 imports S1 schemas and S2 core types; it does NOT import any runtime
adapter or CLI code.

### S3 / runtime boundary (binding)

S3 produces pure, deterministic, in-memory reducer code only. No I/O, no
runtime adapter, no CLI. The only seam to runtime is that S4 will consume the
projections (read-only). S3 is downstream of S2's `EventLogStore.read`
interface but NOT of S2's `RunKernel` — projections take the event array
directly.

### Concrete deliverables

1. **Module layout under `packages/pluto-v2-core/src/projections/`** (NEW
   subdirectory; do NOT introduce a new package):
   - `projections/task-projection.ts` — `taskReducer`, `initialTaskState`,
     `replayTask`.
   - `projections/mailbox-projection.ts` — `mailboxReducer`,
     `initialMailboxState`, `replayMailbox`.
   - `projections/evidence-projection.ts` — `evidenceReducer`,
     `initialEvidenceState`, `replayEvidence`.
   - `projections/replay.ts` — `replayAll(events): { task, mailbox, evidence }`
     and `replayFromStore(store): { task, mailbox, evidence }`. Empty-input
     semantics: `replayAll([])` returns `{ task: initialTaskState.view,
     mailbox: initialMailboxState.view, evidence: initialEvidenceState.view }`.
     `replayFromStore` on an empty store calls `store.read()` (returns `[]`)
     then `replayAll`.
   - `projections/index.ts` — re-exports the public surface.

2. **Reducer API contract (binding).**

   Each reducer follows the signature
   `reducer(state: ReducerState, event: RunEvent): ReducerState` — state is a
   per-projection structure that bundles the view PLUS any private
   accumulator the reducer needs. View extraction is the last step of replay.

   - `type TaskReducerState = { view: TaskProjectionView['view'] }` (no
     accumulator needed).
   - `type MailboxReducerState = { view: MailboxProjectionView['view']; seenMessageIds: ReadonlySet<string> }`
     — `seenMessageIds` is the dedup set (see deliverable 5).
   - `type EvidenceReducerState = { view: EvidenceProjectionView['view']; pendingStartedAt: string | null; seenEventIds: ReadonlySet<string> }`
     — `pendingStartedAt` carries `run_started.payload.startedAt` until
     `run_completed` arrives and `view.run` can be fully populated.
     `seenEventIds` is the citation dedup set.

   Initial states (all exported):

   ```ts
   const initialTaskState: TaskReducerState = { view: { tasks: {} } };
   const initialMailboxState: MailboxReducerState = { view: { messages: [] }, seenMessageIds: new Set() };
   const initialEvidenceState: EvidenceReducerState = { view: { run: null, citations: [] }, pendingStartedAt: null, seenEventIds: new Set() };
   ```

   Replay helpers extract the view at the end:

   ```ts
   const replayTask = (events: RunEvent[]) => events.reduce(taskReducer, initialTaskState).view;
   const replayMailbox = (events: RunEvent[]) => events.reduce(mailboxReducer, initialMailboxState).view;
   const replayEvidence = (events: RunEvent[]) => events.reduce(evidenceReducer, initialEvidenceState).view;
   ```

   Output views MUST PARSE through the corresponding S1 zod schemas
   (`TaskProjectionViewStateSchema`, `MailboxProjectionViewStateSchema`,
   `EvidenceProjectionViewStateSchema`). S3 tests assert `Schema.parse(view)`
   succeeds; S3 source code does NOT call `.parse` at runtime (purity).

3. **Per-kind reducer behavior (binding for v1.0; matches `basic-run.json`).**

   Each reducer is total over its `inputKinds` (S1) and no-op for kinds not
   listed below for that projection. The closed v1.0 behavior:

   | event kind | task | mailbox | evidence |
   |---|---|---|---|
   | `run_started` | no-op | no-op | citation `"Run started."`; store `pendingStartedAt = payload.startedAt` |
   | `run_completed` | no-op | no-op | citation `"Run completed."`; populate `view.run = { runId: event.payload?.runId ?? state.runId-from-event-envelope, status: payload.status, startedAt: pendingStartedAt!, completedAt: payload.completedAt, summary: payload.summary }` (use the event envelope's `runId`); reset `pendingStartedAt = null` |
   | `mailbox_message_appended` | no-op | append `{ messageId, fromActor, toActor, kind, body, sequence: event.sequence, eventId: event.eventId }` if `messageId` not in `seenMessageIds`; otherwise no-op | no-op |
   | `task_created` | insert `tasks[taskId] = { title, ownerActor, state: 'queued', dependsOn, history: [] }` if not present; otherwise no-op | no-op | no-op |
   | `task_state_changed` | update `tasks[taskId].state = to`; append `{ from, to, eventId: event.eventId }` to `history` if not already present | no-op | no-op |
   | `artifact_published` | no-op | no-op | no-op |
   | `request_rejected` | no-op | no-op | no-op |

   Note: `mailbox_message_appended`, `task_state_changed`, `artifact_published`,
   `request_rejected` are listed as `EVIDENCE_PROJECTION_INPUT_KINDS` in S1
   but produce **no view delta** in v1.0. They are reserved for future v1.x
   citation expansion. The S3 design doc states this explicitly.

   `task_created` initial state is `'queued'` per the canonical v2 task
   lifecycle. Run state defaults to `null` until `run_completed`.

4. **Exact summary templates (binding; byte-deterministic).**

   Cited events use these exact strings (no interpolation, no trailing
   whitespace, no leading whitespace, single sentence with terminating period):

   | kind | summary string |
   |---|---|
   | `run_started` | `"Run started."` |
   | `run_completed` | `"Run completed."` |

   No other kind emits citations in v1.0. Future v1.x additions MUST also use
   short fixed strings (no payload interpolation that could vary across
   environments).

5. **Idempotency under reducer-level dedup (binding).**

   Append-style views (mailbox messages, task history entries, evidence
   citations) MUST dedup by stable id:

   - Mailbox: dedup by `messageId` via `seenMessageIds`. A second
     `mailbox_message_appended` with the same `messageId` is a no-op.
   - Task history: dedup by `eventId` per task. A second
     `task_state_changed` with the same `eventId` is a no-op for both
     `state` (already at target) and `history` (already includes that
     transition entry).
   - Evidence citations: dedup by `eventId` via `seenEventIds`. A second
     `run_started` (or `run_completed`) with the same `eventId` is a no-op.
   - Tasks: `task_created` with an existing `taskId` is a no-op (consistent
     with kernel's `state_conflict` rejection at S2; reducer is defensive).

   Result: replaying the same event TWICE through `events.reduce(reducer, initialState)`
   yields the SAME view as replaying it ONCE. The store's append-time
   `DuplicateAppendError` (S2) is a separate guarantee; reducer-level dedup
   makes the projection robust against legitimate replay (e.g. event-log
   re-derivation).

6. **Pure-projection invariants (encoded in tests + grep).**

   - **Determinism**: `replayAll(events)` returns byte-equal output (after a
     stable JSON serialization with sorted object keys) across two runs.
   - **Replay equality**: `replayTask(events)` deep-equals
     `events.reduce(taskReducer, initialTaskState).view`. Same for
     mailbox/evidence.
   - **Reducer-level idempotency** (per deliverable 5): replaying the same
     event twice yields the SAME view as replaying it once.
   - **Empty-input**: `replayAll([])` returns
     `{ task: { tasks: {} }, mailbox: { messages: [] }, evidence: { run: null, citations: [] } }`
     and the value is parseable by S1 view-shape schemas.
   - **basic-run fixture parity**: `replayAll(basic-run.json.events)` deep-equals
     `basic-run.json.expectedViews` exactly (the fixture's `expectedViews`
     ALREADY contains `evidence`; verify against fixture, not hand-written
     expectations).
   - **No I/O**: `projections/**` MUST NOT import any `node:*` I/O module.
   - **No ambient randomness/time**: same grep as S2 over `projections/**`.
   - **No-runtime-leak**: same grep as S1/S2 over `projections/**`.

7. **Tests.**

   Under `packages/pluto-v2-core/__tests__/projections/`:

   - `task-projection.test.ts` — happy-path `task_created` then
     `task_state_changed` queued→completed; out-of-input no-op for
     run_started/run_completed/mailbox/artifact/rejected; replay-equality
     with basic-run.json; reducer-level idempotency (apply same task_created
     twice).
   - `mailbox-projection.test.ts` — happy-path append; sequence ordering;
     out-of-input no-op; idempotency on duplicate `messageId`.
   - `evidence-projection.test.ts` — happy-path on basic-run sequence,
     including `pendingStartedAt` accumulator; `view.run` stays `null` until
     `run_completed`; citation strings match deliverable 4 exactly; idempotency
     on duplicate run_started/run_completed eventIds; no view delta for the
     other 5 input kinds.
   - `replay-all.test.ts` — `replayAll(basic-run.json.events)` deep-equals
     `basic-run.json.expectedViews` (Task + Mailbox + Evidence).
   - `replay-from-store.test.ts` — append all events to a fresh
     `InMemoryEventLogStore`, then `replayFromStore(store)` matches
     `replayAll(events)`. Empty-store test: `replayFromStore(emptyStore)`
     equals `replayAll([])`.

   Total S3 test count target: ≥ 25 across the 5 files.

8. **`FinalReportProjectionView` decision (binding for S3).**

   **DEFER in S3.** Do NOT mutate S1 `projections.ts` in this slice.
   Document the decision in `docs/design-docs/v2-projections.md`:

   - The legacy `final-report.md` content can be derived from the
     intersection of `EvidenceProjectionView` (run summary + citations) +
     `TaskProjectionView` (task tree) + `MailboxProjectionView` (final
     manager message), so a dedicated `FinalReportProjectionView` is not
     required for v1.0 evidence parity.
   - If a future slice (S3.5 or later) determines a dedicated projection
     IS required (e.g. for cross-projection joins not naturally expressible
     by composition), it MUST be introduced as a NEW slice with separate
     operator approval. S1's contract surface stays closed at v1.0; a new
     projection is a major-version contract change.

   This explicit "defer" decision removes the implementer-judgment ambiguity
   the round-1 review flagged.

### Out of scope for S3

- Any runtime adapter (Fake or Paseo) — S4 / S5.
- Any CLI changes — S6.
- Persistence to disk / DB / network beyond what S2's
  `InMemoryEventLogStore` provides.
- v1.6 file-lineage edits.
- Authority / kernel / state-machine code (those are S2; S3 only consumes
  events emitted by S2).

### S3 dependency graph

S3 imports `@pluto/v2-core` schemas (S1) and `core/run-event-log` types
(S2). S3 does NOT depend on S4, S5, or any later slice.

### S3 acceptance bar

- **Package-scoped typecheck**: `pnpm --filter @pluto/v2-core typecheck` clean.
- **Package-scoped vitest**: `pnpm --filter @pluto/v2-core exec vitest run`
  green; the new `projections/` test suite ≥ 5 files; total package test
  count ≥ S2 baseline (153) + 25 = 178; finishes < 90 s.
- **Package-scoped build**: `pnpm --filter @pluto/v2-core build` clean.
- **Root regression**: `pnpm test` green.
- **Reducer purity**: replay-equality + idempotency tests pass.
- **basic-run fixture compatibility**: `replayAll` over `basic-run.json` MUST
  match the fixture's `expectedViews` exactly.
- **No-I/O grep**: `projections/**` does not import any `node:*` I/O module.
- **No-ambient-randomness grep**: clean over `projections/**`.
- **No-runtime-leak grep**: clean over `projections/**`.
- **Closure proofs**:
  - Each projection's runtime reducer respects the S1 declared `inputKinds`
    / `outOfScopeKinds` partition.
  - The fixture-coverage table in the design doc matches the actual reducer
    behaviors.
- **Diff hygiene**: edits limited to:
  - `packages/pluto-v2-core/src/projections/**`
  - `packages/pluto-v2-core/__tests__/projections/**`
  - `packages/pluto-v2-core/src/index.ts` (additive `projections/*`
    re-exports)
  - `packages/pluto-v2-core/README.md` (additive S3 section)
  - `docs/design-docs/v2-projections.md` (new)
  - `docs/plans/active/v2-rewrite.md` — S3 status row only.
  - **NO edits** to S1 schema files (`projections.ts`, `run-event.ts`, etc.),
    S2 core files, root config, or any v1.6 surface. The S1 contract surface
    stays closed at v1.0 (per deliverable 8 — `FinalReportProjectionView` is
    deferred, not added in S3).
- **Branch is committed AND pushed**: `commit_and_push` step + `verify_pushed_state`.
- A reviewer sub-agent confirms (a) replay-equality on `basic-run.json`,
  (b) input-kind closure per reducer, (c) determinism + idempotency, (d)
  no-I/O / no-runtime-leak / no-ambient-randomness greps, (e) diff hygiene,
  (f) `FinalReportProjectionView` decision documented.

## S4 — Phase 4: Fake runtime end-to-end (next slice)

### Outcome

Wire the v2 stack end-to-end with a **Fake runtime adapter** that produces
deterministic agent behavior without any LLM calls or external runtime
dependencies. The Fake adapter exercises the full v2 path: authored-spec
loading → `SpecCompiler` → `TeamContext` → `RunKernel.submit(...)` →
`RunEventLog` → projections → `EvidencePacket`-shaped output. Includes
**parity tests** against captured v1.6 live-smoke fixtures asserting that v2
produces equivalent evidence shapes for the same scenario.

This is the first slice where v2 leaves the pure-core boundary and touches
**runtime concerns** (file I/O, scenario authoring, deterministic adapters).
S5 introduces the real-LLM Paseo adapter; S6 switches the CLI default to v2.

### S4 / runtime boundary (binding)

S4 introduces a **runtime layer** that lives OUTSIDE
`packages/pluto-v2-core/`. The pure-core package stays runtime-free. The new
runtime code lives under either:

- `packages/pluto-v2-runtime/` (a new workspace package), OR
- `src/v2-runtime/` (a top-level subdir inside the legacy src/).

**Decision (binding):** new package `packages/pluto-v2-runtime/` to keep the
v2 surface physically separated from v1.6 src/. Add to root
`pnpm-workspace.yaml` (additive). This is the second package introduction
under the v2 surface (after `packages/pluto-v2-core/` from S1) — same
.gitignore allow-list pattern (`!packages/pluto-v2-runtime/`).

### S4 mutates two S2 files (both additive-only)

S4 introduces TWO controlled S2 mutations, each additive-only, both gated
by acceptance:

1. `packages/pluto-v2-core/src/core/team-context.ts` — adds optional
   `fakeScript` field to `AuthoredSpecSchema` (deliverable 2).
2. `packages/pluto-v2-core/src/core/run-kernel.ts` — adds new public method
   `RunKernel.seedRunStarted(payload, ctx?)` (deliverable 3, kernel API
   extension). The kernel today only exposes `submit(rawRequest)`, but
   `RunStartedEventSchema` is `system`-emitted with `requestId: null`, so
   it has no production path. Adding a single seed API is the minimum-
   surface fix.

Both mutations are STRICTLY ADDITIVE: no existing public surface is
renamed, removed, or behaviorally altered. Existing callers of `submit`
are unaffected. Discovery confirmed `runScenario` cannot stitch
`run_started` from outside without bypassing kernel state ownership
(kernel `#state` is private and only mutated through `submit`); a
seed-from-outside approach would desync state from eventLog. The kernel
extension keeps the contract clean.

`run_completed` stays request-backed via the existing `complete_run`
intent in `submit`. No second seed API.

### Concrete deliverables

1. **Module layout under `packages/pluto-v2-runtime/`** (NEW workspace
   package; same allow-list pattern as v2-core):

   - `package.json` — `name: "@pluto/v2-runtime"`, `type: module`, ESM-only.
     Runtime deps: `@pluto/v2-core` (workspace), `zod`, `js-yaml` (only for
     YAML loading; no other I/O libs). DevDeps: `vitest`, `@types/node`,
     `typescript`.
   - `tsconfig.json` — strict, ESM, package-scoped scripts (`typecheck`,
     `build`, `test`).
   - `src/loader/`:
     - `authored-spec-loader.ts` — `loadAuthoredSpec(path: string): AuthoredSpec`.
       Reads file from disk via `node:fs`, parses YAML via
       `yaml.load(content, { schema: yaml.FAILSAFE_SCHEMA })` (single-doc,
       safe schema only — no `!!js/*` tags, no merge keys, no anchors that
       reach into the host environment), then validates via
       `AuthoredSpecSchema` (S2, strict). THIS IS THE ONLY I/O ENTRY POINT
       IN v2-RUNTIME. Loader rejects multi-document YAML and any value that
       fails post-parse Zod validation. JSON is parsed via `JSON.parse`.
     - `scenario-loader.ts`, `playbook-loader.ts`, `agent-loader.ts`,
       `run-profile-loader.ts` — typed loaders for each authored layer; emit
       a unified `AuthoredSpec` value.
   - `src/runtime/`:
     - `runtime-adapter.ts` — closed `RuntimeAdapter` interface (concrete TS
       in deliverable 3 below) that S5's Paseo adapter will also implement.
     - `runner.ts` — `runScenario(authoredSpec, adapter, options)` provider-
       agnostic driver. 9-step algorithm in deliverable 3.
     - `kernel-view.ts` — read-only kernel snapshot type
       `{ state: RunState; events: ReadonlyArray<RunEvent> }` passed into
       adapter on each step.
   - `src/adapters/fake/`:
     - `fake-adapter.ts` — implements `RuntimeAdapter`. Produces deterministic
       ProtocolRequests for a given TeamContext, scripted by the scenario's
       `fakeScript` field (deliverable 2). Resolves `$ref` tokens at step
       time against the kernel-view event stream (deliverable 2 grammar).
     - `fake-script.ts` — script schema (Zod) + `$ref` resolver +
       interpreter. Token grammar in deliverable 2.
     - `fake-run.ts` — convenience wrapper:
       `runFake(authored, options) = runScenario(authored, makeFakeAdapter(authored.fakeScript), options)`.
   - `src/evidence/`:
     - `evidence-packet.ts` — `EvidencePacketShape` Zod schema (v2 shape,
       NOT v1.6 shape verbatim — v2 covers a documented subset; see
       deliverable 5 normalization table) + assembly given Task / Mailbox /
       Evidence views.
   - `src/legacy/`:
     - `v1-translator.ts` — pure function
       `translateLegacyEvents(legacyEvents: unknown[]): RunEvent[]`.
       Implements the binding map/drop/infer table in deliverable 5.
   - `src/index.ts` — re-exports public surface
     (`runScenario`, `RuntimeAdapter`, `loadAuthoredSpec`,
     `assembleEvidencePacket`, `translateLegacyEvents`).

2. **`fakeScript` authoring shape (closed at v1.0).**

   Adds an optional field to S2's `AuthoredSpec` schema in
   `packages/pluto-v2-core/src/core/team-context.ts`:

   ```ts
   // FakeScriptStepSchema (Zod, discriminated by `intent`):
   //   - actor: ActorRefSchema
   //   - intent: 'append_mailbox_message' | 'create_task' | 'change_task_state'
   //             | 'publish_artifact' | 'complete_run'
   //   - payload: matches the corresponding ProtocolRequest payload schema
   //   - idempotencyKey: optional string | null
   //
   // Payload values may use a closed token grammar to reference IDs from
   // earlier accepted events:
   //   { "$ref": "events[<index>].payload.<dotted-path>" }
   //
   // <index> is a non-negative integer (0-based) into the eventLog after
   //   `run_started` (i.e. events[0] is the first request-backed accepted
   //   event). Negative indices are NOT supported in v1.0.
   // <dotted-path> is a dotted path into the matching event's `payload`,
   //   restricted to known v2 payload field names per RunEventSchema.
   //
   // The resolver:
   //   - Walks each payload value pre-submit; if a value matches the
   //     `{ "$ref": "events[i].payload.X" }` shape exactly, replaces it
   //     with the resolved value from the eventLog.
   //   - Throws if `events[i]` does not exist or `payload.X` is missing
   //     (closed grammar; no fallback).
   //
   // Example: a `change_task_state` step references a `task_created` taskId
   //   step 0 → create_task → events[0].payload.taskId
   //   step 1 → change_task_state with payload.taskId = { "$ref":
   //            "events[0].payload.taskId" }

   fakeScript?: Array<FakeScriptStep>;
   ```

   **Justification (S1 versioning policy):** strict additive optional field.
   Existing v1.0 specs without `fakeScript` parse cleanly; specs with
   `fakeScript` parse and the field is consumed only by the fake adapter.
   No existing field is renamed or removed. Per S1 versioning policy, this
   is a non-breaking minor change at v1.0.

   **Mutation scope (binding):** the only edit to `team-context.ts` is the
   addition of `FakeScriptStepSchema`, the `fakeScript` field on
   `AuthoredSpecSchema`, and any imports those need. No semantic edits to
   the existing `AuthoredSpec` shape, validation rules, or
   `compileTeamContext` body. Acceptance enforces this by reviewing the
   diff scope against `team-context.ts`.

3. **`RuntimeAdapter` interface and `runScenario` driver (concrete TS).**

   Closed `RuntimeAdapter` interface (S4, reused by S5):

   ```ts
   import type { ProtocolRequest, RunEvent, RunState, TeamContext }
     from '@pluto/v2-core';

   export interface KernelView {
     readonly state: RunState;
     readonly events: ReadonlyArray<RunEvent>;
   }

   export type RuntimeAdapterStep<S> =
     | { kind: 'request'; request: ProtocolRequest; nextState: S }
     | { kind: 'done';
         completion: {
           status: 'succeeded' | 'failed' | 'cancelled';
           summary: string | null;
         };
         nextState: S;
       };

   export interface RuntimeAdapter<S = unknown> {
     /**
      * Build initial adapter state. Called once after run_started is seeded.
      * Synchronous; adapter MUST NOT do I/O or read ambient time/randomness.
      * Use providers from `runScenario` options instead.
      */
     init(teamContext: TeamContext, view: KernelView): S;

     /**
      * Decide the next protocol request OR signal completion. Synchronous.
      * Errors thrown propagate out of `runScenario` (run is aborted; no
      * synthetic run_completed is emitted).
      */
     step(state: S, view: KernelView): RuntimeAdapterStep<S>;
   }
   ```

   Notes:
   - **Sync-only at v1.0.** S5's Paseo adapter will buffer
     LLM-call results elsewhere; the adapter step itself stays sync. If
     async is needed in S5+, that's a closed v2.0 contract change.
   - **Adapter owns its state** between steps via `nextState`. `runScenario`
     never inspects `S`.
   - **`done.completion`** is what `runScenario` uses to build the
     `complete_run` ProtocolRequest payload (status + summary).
   - **Errors** thrown from `init` or `step` propagate; the run aborts. No
     synthetic completion.
   - **`KernelView.events`** is a stable snapshot from `eventLog.read(0,
     head + 1)` taken before each step. Adapter MUST treat it read-only.

   `runScenario` driver:

   ```ts
   function runScenario<S>(
     authored: AuthoredSpec,
     adapter: RuntimeAdapter<S>,
     options: {
       idProvider: IdProvider;
       clockProvider: ClockProvider;
       correlationId?: string | null;
       maxSteps?: number; // default 1000; throws if exceeded
     }
   ): {
     events: ReadonlyArray<RunEvent>;
     views: { task: TaskProjectionView['view'];
              mailbox: MailboxProjectionView['view'];
              evidence: EvidenceProjectionView['view'] };
     evidencePacket: EvidencePacket;
   };
   ```

   9-step algorithm:
   1. `teamContext = compileTeamContext(authored)` (S2).
   2. `kernel = new RunKernel({ initialState: initialState(teamContext),
      idProvider, clockProvider })` (call the named `initialState` factory
      function from `packages/pluto-v2-core/src/core/run-state.ts`).
   3. `kernel.seedRunStarted({ scenarioRef: teamContext.scenarioRef,
      runProfileRef: teamContext.runProfileRef,
      startedAt: clockProvider.nowIso() }, { correlationId })`.
   4. `let adapterState = adapter.init(teamContext, kernelViewOf(kernel))`.
   5. Loop up to `maxSteps`:
      - `view = kernelViewOf(kernel)`.
      - `step = adapter.step(adapterState, view)`.
      - If `step.kind === 'done'`: build a `complete_run` ProtocolRequest
        with the **manager actor** (`{ kind: 'manager' }`) — per
        `AUTHORITY_MATRIX.complete_run = [{ kind: 'manager' }]` in
        `packages/pluto-v2-core/src/core/authority.ts` only `manager` is
        authorized; the manager actor must therefore be present in
        `teamContext.declaredActors`. `step.completion` becomes the
        request payload. `kernel.submit(request, { correlationId })`, then
        `adapterState = step.nextState`, break.
      - Else `step.kind === 'request'`: `kernel.submit(step.request,
        { correlationId })`, `adapterState = step.nextState`. (If the
        kernel emits `request_rejected`, the loop continues; the adapter
        sees the rejection in `view.events` on its next step and decides.)
   6. If loop exits without `done`, throw `RunNotCompletedError` (no
      synthetic `run_completed`).
   7. `events = kernel.eventLog.read(0, kernel.eventLog.head + 1)`.
   8. `views = replayAll(events)` (S3).
   9. `evidencePacket = assembleEvidencePacket(views, events,
      kernel.state.runId)` — assembly takes the event stream too because
      `replayAll` does not project artifacts (see deliverable 5).

   **Manager actor seeding:** the `compileTeamContext` step MUST include
   `{ kind: 'manager' }` in `declaredActors` whenever the authored spec
   targets `runScenario`. The fake adapter's hello-team scenario adds
   `actor: 'manager'` to its `declaredActors` list explicitly. The
   loader rejects authored specs whose `fakeScript` includes a
   `complete_run` step but whose `declaredActors` does not include
   `manager`.

4. **Kernel API extension: `RunKernel.seedRunStarted` (S2 file edit).**

   Add to `packages/pluto-v2-core/src/core/run-kernel.ts`:

   ```ts
   seedRunStarted(
     payload: {
       scenarioRef: string;
       runProfileRef: string;
       startedAt: string; // ISO 8601
     },
     ctx?: RunKernelSubmitContext,
   ): { event: RunStartedEvent }
   ```

   Behavior:
   - Throws if eventLog is non-empty (run_started must be the first event).
   - Builds a `RunStartedEvent` envelope: `eventId = idProvider.next()`,
     `runId = state.runId`, `sequence = state.sequence + 1`,
     `timestamp = clockProvider.nowIso()`, `actor = { kind: 'system' }`,
     `requestId = null`, `causationId = null`,
     `correlationId = ctx?.correlationId ?? null`,
     `entityRef = { kind: 'run', runId }`, `outcome = 'accepted'`,
     `kind = 'run_started'`, `payload = <input payload>`.
   - Validates via `RunStartedEventSchema.parse`.
   - Appends to eventLog and reduces internal `#state` (same path as
     `submit`).
   - Returns `{ event }`.

   This is **strictly additive**: no existing kernel surface is touched.
   Two new acceptance tests in
   `packages/pluto-v2-core/__tests__/core/run-kernel.test.ts` (within
   the existing file): (a) seedRunStarted produces a valid run_started
   event and updates state.status to 'running'; (b) calling
   seedRunStarted on a kernel whose eventLog already has events throws.

   `run_completed` continues to use the existing `complete_run` intent
   path through `submit`; no `seedRunCompleted` is added.

5. **Evidence packet shape (v2-only) and parity normalization.**

   `EvidencePacketShape` is a v2-native Zod schema, NOT a verbatim copy of
   v1.6 evidence-packet.json. The v2 fields cover ONLY what current v2
   projections produce, plus a flat `artifacts` list scanned directly
   from the event stream (since `replayAll` in S3 does not include an
   artifact projection — `packages/pluto-v2-core/src/projections/replay.ts`
   only produces `task`, `mailbox`, `evidence` views):

   ```ts
   EvidencePacketShape = {
     schemaVersion: '1.0',         // v2 schema, not v1.6 schema=0
     kind: 'evidence_packet',
     runId: string,
     status: 'succeeded' | 'failed' | 'cancelled' | 'in_progress',
     summary: string | null,
     startedAt: string | null,     // from evidence.run.startedAt
     completedAt: string | null,   // from evidence.run.completedAt
     citations: Array<{ eventId, kind, text, observedAt }>,  // from evidence.citations
     tasks: TaskProjectionView['view']['tasks'],
     mailboxMessages: ReadonlyArray<{
       messageId, fromActor, toActor, kind, body, sequence,
     }>,                           // from mailbox.messages
     artifacts: ReadonlyArray<{
       artifactId, kind, mediaType, byteSize,
     }>,                           // scanned from artifact_published events
   }
   ```

   `assembleEvidencePacket(views, events, runId)` assembles by:
   - Reading `views.evidence.run` for `status`, `summary`, `startedAt`,
     `completedAt`.
   - Copying `views.task.tasks` and `views.mailbox.messages` directly.
   - Filtering `events` for `kind === 'artifact_published'` and projecting
     `{ artifactId, kind, mediaType, byteSize }` per event.
   - Reading `views.evidence.citations` directly.

   **v1.6 → v2 evidence-packet field normalization (binding parity table):**

   | v1.6 field | v2 status | rule |
   |---|---|---|
   | `runId` | strict equal | byte-equal string match |
   | `schemaVersion` | ignored | namespaces differ (v1.6=0, v2='1.0') |
   | `kind` | strict equal | both `'evidence_packet'` |
   | `status` | strict equal | string equal |
   | `summary` | strict equal | string-or-null equal |
   | `failureReason` | ignored | not produced by v2 in S4 |
   | `coordinationChannel` | ignored | out of v2 scope (deferred) |
   | `artifactRefs` | normalized compare | the v1.6 packet's `artifactRefs` includes 1 `artifact` row sourced from the legacy `artifact_created` event, plus 3 derived metadata rows (`task_tree`, `status`, `final_report`) produced by v1.6 evidence generation, NOT from any event. The v2 translator produces v2 `artifact_published` events ONLY for legacy `artifact_created` rows. Parity asserts: the count of v2 `EvidencePacket.artifacts` (1) equals the count of legacy `artifact_created` events in `events.jsonl` (1); v2 packet does NOT attempt to reconstruct the `task_tree`/`status`/`final_report` rows |
   | `transitions` | ignored | derived from v1.6 task list / mailbox summary, not modeled in v2 projections at S4 |
   | `roleCitations` | ignored | out of v2 scope (deferred) |
   | `lineage` | ignored | runtime-helper-usage / file-lineage out of scope |
   | `generatedAt` | abstracted | both must parse as ISO 8601; values not compared |

   The parity test asserts: for the in-scope rows above, the v2 packet
   built from translated legacy events matches the v1.6 packet field-for-
   field. Ignored rows are skipped explicitly (the test does NOT consume
   them). The test fails if any row marked "strict equal" or "normalized
   compare" diverges.

6. **Legacy v1.6 → v2 event translator (binding map/drop/infer table).**

   The captured fixture
   `tests/fixtures/live-smoke/86557df1-0b4a-4bd4-8a75-027a4dcd5d38/events.jsonl`
   contains 20 distinct `type` values; v2's closed event set has 7. The
   translator implements this binding table (one row per legacy `type`):

   | legacy type | v2 disposition | rule |
   |---|---|---|
   | `run_started` | **map** | → v2 `run_started`; legacy payload `scenario`/`runProfile` map to v2 `scenarioRef`/`runProfileRef`; `startedAt` from envelope `ts`. The translator emits a v2 `run_started` envelope with `actor: { kind: 'system' }`, `requestId: null`. |
   | `lead_started` | **drop** | subsumed by `run_started` (legacy duplicate) |
   | `run_completed` | **map** | → v2 `run_completed`. Legacy payload only has `{ workerCount, playbookId }` — NO `status`, `summary`, `completedAt`. Synthesize defaults: `status = 'succeeded'` (legacy fixtures lacking explicit failure are treated as successful), `summary = null`, `completedAt = <envelope ts>`. The translator emits with `actor: { kind: 'manager' }`, `requestId = idProvider.next()` (deterministic from envelope `eventId`). |
   | `final_reconciliation_received` | **drop** | subsumed by `run_completed` |
   | `task_created` | **map** | → v2 `task_created`; copy `taskId`, `title`, `ownerActor`, `dependsOn` (default `[]`) |
   | `task_claimed` | **infer** | → v2 `task_state_changed` from `queued` → `running` |
   | `task_completed` | **infer** | → v2 `task_state_changed` from `running` → `completed` |
   | `mailbox_message` | **map** (with filter) | → v2 `mailbox_message_appended`. Legacy payload carries `messageId`, `to`, `from`, `kind`, `transportMessageId`. The legacy `kind` is mapped to v2 `MailboxMessageKindSchema` per the sub-table below; if the legacy kind has no v2 mapping, the row is **dropped**. `body` is synthesized as the empty string `""` because legacy `events.jsonl` does NOT carry message body (body lives in `mailbox.jsonl`, which is out of S4 scope). `fromActor` / `toActor` are reconstructed by `actorRef` lookup in TeamContext keyed on legacy `from` / `to` strings |
   | `mailbox_message_queued` | **drop** | transport-only metadata (`transportMessageId`, `queueDepth`, `queuedAt`); no message semantics |
   | `mailbox_message_delivered` | **drop** | transport-only metadata (`transportMessageId`, `deliveredAt`); no message semantics |
   | `lead_message` | **drop** | legacy lead-internal event; not a mailbox surface |
   | `plan_approval_requested` | **drop** | already represented by the corresponding `mailbox_message` row whose `kind` is `plan_approval_request` |
   | `plan_approval_responded` | **drop** | already represented by the corresponding `mailbox_message` row whose `kind` is `plan_approval_response` (mapped to v2 `plan_approval_response`) |
   | `artifact_created` | **map** | → v2 `artifact_published`; legacy payload carries only `path` and `playbookId` (NO `artifactId`, `mediaType`, `byteSize` in v1.6 fixture). Synthesize: `artifactId = idProvider.next()` deterministically seeded from legacy `eventId`; `kind = 'final'`; `mediaType = 'text/markdown'`; `byteSize = 0` (placeholder, since translator does NOT read the artifact file). The parity test compares ARTIFACT COUNT against the legacy `artifact_created` event count, NOT against the v1.6 packet's `artifactRefs.length` (which includes 3 derived metadata files: `task_tree`, `status`, `final_report` — produced by v1.6 evidence generation, not by `artifact_created` events). |
   | `worker_started` | **drop** | internal coordination, not a v2 surface |
   | `worker_completed` | **drop** | task state change is already represented by `task_completed` legacy event |
   | `worker_complete_received` | **drop** | internal coordination |
   | `spawn_request_received` | **drop** | internal coordination |
   | `spawn_request_executed` | **drop** | internal coordination |
   | `coordination_transcript_created` | **drop** | out of v2 scope (deferred) |

   **Legacy mailbox-kind → v2 MailboxMessageKind sub-table:**

   | legacy `payload.kind` | v2 disposition | rule |
   |---|---|---|
   | `text` | **drop** | no v2 closed-set equivalent |
   | `plan_approval_request` | **map** → `plan_approval_request` | exact |
   | `plan_approval_response` | **map** → `plan_approval_response` | exact |
   | `worker_complete` | **map** → `completion` | semantic |
   | `spawn_request` | **drop** | internal coordination |
   | (any other) | **drop** | unknown legacy mailbox kind; closed |

   The translator preserves legacy event order. For `infer` rows, the
   translator carries minimal state (the last seen `state` per `taskId`)
   to fill the `from` field. For `map` rows missing optional fields, the
   translator synthesizes defaults documented in the table (e.g.
   `dependsOn = []`). The translator emits an envelope with v2-shaped
   `eventId`, `sequence`, `requestId` chosen deterministically from the
   legacy `eventId` (e.g. namespaced UUIDv5) so the parity test can run
   without ambient randomness. Unknown legacy `type` values are an
   explicit error (closed grammar; new legacy types require a translator
   update). Unknown legacy mailbox `payload.kind` values are dropped per
   the sub-table above (translator does not throw, since legacy mailbox
   kinds may proliferate).

7. **Scenario fixtures** (under `packages/pluto-v2-runtime/test-fixtures/`):

   - `scenarios/hello-team/scenario.yaml` — v2 authored spec with
     `fakeScript` for a small 4-actor lead/planner/generator/evaluator run.
     Uses the closed `$ref` grammar from deliverable 2 to thread
     `task_created.payload.taskId` through subsequent
     `change_task_state` steps.
   - `scenarios/hello-team/expected-events.jsonl` — expected event stream
     produced by `runScenario(spec, fakeAdapter)` with fixed providers.
   - `scenarios/hello-team/expected-evidence-packet.json` — expected v2
     evidence packet (v2 shape from deliverable 5, NOT v1.6 shape).

8. **Pure invariants for the runtime package.**

   - **No paseo / no opencode / no claude / no helper-cli** in
     `packages/pluto-v2-runtime/src/**` (same no-runtime-leak grep, with
     `paseo` and `opencode` allowed only inside a future `src/adapters/paseo/`
     subdir which S5 introduces; S4 ships only `src/adapters/fake/`).
   - **Determinism**: `runScenario(spec, fakeAdapter, fixed-providers)`
     produces byte-equal events twice.
   - **No I/O outside the loader entry point**: only files under
     `packages/pluto-v2-runtime/src/loader/**` may import `node:fs` or
     `js-yaml`. Acceptance grep enforces this.
   - **No ambient randomness/time outside providers**: same rule as core.

9. **Tests (S4 scope; under `packages/pluto-v2-runtime/__tests__/`).**

   - `loader/authored-spec-loader.test.ts` — round-trip YAML → AuthoredSpec
     parse; one negative per closed compile-error reason; rejects
     multi-document YAML; rejects YAML using `!!js/*` tags.
   - `adapters/fake/fake-script.test.ts` — `$ref` resolver: resolves valid
     refs, throws on invalid index / missing path; rejects malformed token
     shapes.
   - `adapters/fake/fake-adapter.test.ts` — fake adapter produces scripted
     requests in order; deterministic given fixed providers.
   - `adapters/fake/fake-run.test.ts` — `runFake(hello-team)` end-to-end:
     events match `expected-events.jsonl`; views match expected; evidence
     packet matches `expected-evidence-packet.json` (v2 shape).
   - `runtime/runner.test.ts` — `runScenario` orchestrates loop correctly;
     handles adapter `done` signal; `RunNotCompletedError` thrown when
     adapter doesn't emit `done` within `maxSteps`; `kernel.seedRunStarted`
     is called exactly once.
   - `evidence/evidence-packet.test.ts` — packet assembly from views
     against the v2 `EvidencePacketShape` schema.
   - `legacy/v1-translator.test.ts` — translator from v1.6 events.jsonl to
     v2 RunEvent: at least one assertion per row in deliverable 6 table;
     rejects unknown legacy types.
   - `parity/hello-team-parity.test.ts` — parity gate: load
     `tests/fixtures/live-smoke/86557df1-...`, translate → `replayAll` →
     `assembleEvidencePacket`, then compare against the v1.6 packet
     row-by-row using the deliverable 5 normalization table.

   Total S4 test count: ≥ 30 across the 8 files. The two recommended
   advisory translator coverage fixtures from the discovery review
   (`1475ff86-...`, `a55b71bb-...`) are NOT included as parity gates in
   S4 (only `86557df1-...` is binding); they may be added later if
   translator drift is observed.

10. **Docs.**

    - `packages/pluto-v2-runtime/README.md` — public surface enumeration;
      "Fake runtime only; Paseo runtime arrives in S5".
    - `docs/design-docs/v2-fake-runtime.md` — runtime layout, RuntimeAdapter
      interface, fakeScript schema + `$ref` grammar, parity normalization
      table (deliverable 5), legacy translator map/drop/infer table
      (deliverable 6), kernel `seedRunStarted` API justification, the two
      additive S2 mutations (`team-context.ts` + `run-kernel.ts`).

### Out of scope for S4

- Real LLM via Paseo / OpenCode / Claude (S5).
- CLI changes (S6).
- Live-smoke against real LLMs (R8 / S5).
- v1.6 file-lineage edits.
- `FinalReportProjectionView` (still deferred).

### S4 dependency graph

S4 imports `@pluto/v2-core` (S1 + S2 + S3). S4 mutates TWO S2 files, each
ADDITIVE-ONLY:

1. `packages/pluto-v2-core/src/core/team-context.ts` — adds
   `FakeScriptStepSchema` and optional `fakeScript` field on
   `AuthoredSpecSchema` (deliverable 2). No semantic edits to existing
   AuthoredSpec.
2. `packages/pluto-v2-core/src/core/run-kernel.ts` — adds new public method
   `RunKernel.seedRunStarted(payload, ctx?)` (deliverable 4). No edits to
   `submit` or other existing surface.

No other S1/S2/S3 mutations.

### S4 acceptance bar

- **Package-scoped typecheck** for `@pluto/v2-runtime` AND `@pluto/v2-core`
  clean.
- **Package-scoped vitest** for both packages green; v2-runtime adds ≥ 30
  S4 tests; total v2 tests ≥ S3 baseline (180) + 30 + 2 (kernel seed
  tests) = 212.
- **Package-scoped build** for both clean.
- **Root regression**: `pnpm test` green (legacy v1.6 unaffected).
- **Determinism**: `runFake(hello-team)` byte-equal across two runs.
- **Parity test passes**: v2 projection of translated v1.6 fixture events
  matches v1.6 evidence packet row-by-row per deliverable 5 normalization
  table.
- **Translator coverage**: at least one assertion per row in deliverable
  6 map/drop/infer table; unknown legacy types throw.
- **No-runtime-leak grep** over `packages/pluto-v2-runtime/src/**`: no
  matches for paseo/opencode/claude (only allowed inside future
  `src/adapters/paseo/` which doesn't exist in S4).
- **No-I/O outside loader**: source under
  `packages/pluto-v2-runtime/src/**` excluding
  `packages/pluto-v2-runtime/src/loader/**` does NOT import `node:fs`,
  `js-yaml`, or any other I/O library. Acceptance grep enforces this.
- **No-ambient-randomness** in v2-runtime source (everything goes through
  injected `idProvider` / `clockProvider`).
- **S2 mutations are scoped**: diff of
  `packages/pluto-v2-core/src/core/team-context.ts` is bounded to additive
  `FakeScriptStepSchema` + `fakeScript` field; diff of
  `packages/pluto-v2-core/src/core/run-kernel.ts` is bounded to additive
  `seedRunStarted` method (and any imports that needs). No semantic edits
  to existing surfaces. Reviewer enforces by reading the diff (NOT by
  literal hunk count — imports may move).
- **Kernel seed test coverage**: at least 2 new tests in
  `packages/pluto-v2-core/__tests__/core/run-kernel.test.ts` for
  `seedRunStarted` (happy path + reject when eventLog non-empty).
- **Diff hygiene**:
  - `packages/pluto-v2-runtime/**` (new package)
  - `packages/pluto-v2-core/src/core/team-context.ts` (additive scope only)
  - `packages/pluto-v2-core/src/core/run-kernel.ts` (additive scope only)
  - `packages/pluto-v2-core/src/index.ts` (additive re-exports for
    `FakeScriptStepSchema` / `seedRunStarted` types if exposed)
  - root `pnpm-workspace.yaml` (add `packages/pluto-v2-runtime`)
  - root `.gitignore` (add `!packages/pluto-v2-runtime/` allow-list
    exception)
  - root `pnpm-lock.yaml` (regenerated)
  - `packages/pluto-v2-core/__tests__/core/team-context.test.ts` for
    `fakeScript` coverage
  - `packages/pluto-v2-core/__tests__/core/run-kernel.test.ts` for
    `seedRunStarted` coverage (additive tests; existing tests untouched)
  - `packages/pluto-v2-core/README.md` (additive note)
  - `docs/design-docs/v2-fake-runtime.md` (new)
  - `docs/plans/active/v2-rewrite.md` — S4 status row only.
  - **NO edits** to v1.6 `src/`, `tests/`, `evals/`, `docker/`, `playbooks/`,
    `scenarios/`, `run-profiles/`, `agents/`, other S2 core files, or S3
    projection files.
- **Branch is committed AND pushed**: `commit_and_push` step.
- A reviewer sub-agent confirms (a) RuntimeAdapter interface is concrete TS
  with `init`/`step`/`done` semantics matching deliverable 3, (b)
  `fakeScript` and `seedRunStarted` are strictly additive on the named
  S2 files, (c) loader is the only I/O entry point, (d) parity test
  exercises the captured fixture row-by-row per deliverable 5, (e)
  translator covers deliverable 6 table row-by-row, (f) S5 will be able
  to drop in a Paseo adapter implementing the same `RuntimeAdapter`
  without changing `runScenario` or the kernel.

## S5 — Phase 5: Paseo runtime adapter + bounded live smoke (next slice)

### Outcome

Drop a real-LLM `PaseoRuntimeAdapter` into the closed `RuntimeAdapter<S>`
slot established in S4, plus a CLI-shell-out `PaseoCliClient`, plus
ONE bounded live-smoke run that produces a captured fixture under
`tests/fixtures/live-smoke/<newRunId>/` for use by future v2 work.

This is the first slice where v2 hits a real LLM. **All LLM access in
v2 goes through Paseo** — Paseo is the unified agent-management surface
(it aggregates OpenCode / Claude / etc. behind one CLI). v2 has NO
provider-specific adapters: there is exactly ONE runtime adapter
(`PaseoRuntimeAdapter`) that talks to the paseo CLI; per-agent provider
/ model differences are configured at the Paseo level via
`paseo run --provider X --model Y` arguments derived from the run
profile. The S4 runner (`runScenario`) and the v2 kernel are
**unchanged**.

### Transport contract (BINDING — discovery-grounded)

The paseo daemon does NOT expose a chat-completion HTTP endpoint
(panel probe found only `GET /api/health` + `GET /api/status`). The
v1.6 codebase already integrates paseo via the **CLI agent lifecycle**
in `src/adapters/paseo-opencode/paseo-cli-client.ts`. S5 mirrors that
shape under the v2 package surface:

```
paseo run --detach --json --provider <P> --model <M> --mode <Mo> \
          --title <T> [--label k=v ...] [--cwd <dir>] [--host H]
  → spawn an agent; stdout JSON contains the agent ID

paseo send <agentId> --no-wait --prompt-file <path> [--host H]
  → deliver a prompt via temp file (avoids CLI length limits)

paseo wait <agentId> --timeout <sec> --json [--host H]
  → wait for the agent to become idle (one assistant turn complete)

paseo logs <agentId> --filter text --tail <N> [--host H]
  → read the agent's transcript text (filtered to assistant output)

paseo ls --json [--host H]
  → list current sessions; used for session-existence checks

paseo delete <agentId> [--host H]
  → cleanup at run end (best-effort; failure does not abort the run)
```

These exact commands and flag names are confirmed against
`/Users/.../paseo` binary on the local box AND `daytona exec paseo ...`
on the sandbox. The v2 client re-implements a small subset (no v1.6
src/ edits) — the v1.6 client is the reference oracle, not a
dependency.

**There is NO HTTP transport in v2.** The "no-HTTP" gate becomes
"no `node:http` / `node:https` / direct `fetch(` anywhere under
`packages/pluto-v2-runtime/src/**`". The "no-process-spawn" gate
becomes "`child_process.spawn` allowed ONLY inside
`packages/pluto-v2-runtime/src/adapters/paseo/paseo-cli-client.ts`".

### S5 scope is narrow on purpose

- ONE new adapter directory `packages/pluto-v2-runtime/src/adapters/paseo/`
  (S4 already reserved this path in the no-runtime-leak grep exception).
- ZERO S1/S2/S3/S4 surface mutations. If the adapter cannot be expressed
  inside the closed S4 RuntimeAdapter contract (extended via a Paseo
  sub-interface), S5 STOPS and the slice is reopened.
- ONE bounded live-smoke run (per R8). Captured fixture is the slice's
  primary evidence artifact.
- ZERO new runtime deps. Uses Node built-in `child_process` for paseo
  CLI invocation; uses Zod (already a dep) for directive parsing.

### Concrete deliverables

1. **PaseoCliClient (CLI transport).**

   `packages/pluto-v2-runtime/src/adapters/paseo/paseo-cli-client.ts`

   Wraps the paseo CLI binary via `child_process.spawn`. THIS IS THE
   ONLY file in `packages/pluto-v2-runtime/src/**` allowed to import
   `node:child_process`.

   Closed surface:

   ```ts
   export interface PaseoAgentSpec {
     readonly provider: string;       // e.g. 'opencode'
     readonly model: string;          // e.g. 'openai/gpt-5.4-mini'
     readonly mode: string;           // e.g. 'build'
     readonly thinking?: string;      // e.g. 'high'
     readonly title: string;
     readonly initialPrompt: string;  // positional <prompt> arg for `paseo run`;
                                      // becomes the first user turn for the actor
     readonly labels?: ReadonlyArray<`${string}=${string}`>;  // paseo CLI rejects bare ids
     readonly cwd?: string;            // sandbox-side path when --host targets a remote daemon
   }

   export interface PaseoAgentSession {
     readonly agentId: string;
   }

   export interface PaseoLogsResult {
     readonly transcriptText: string;  // assistant-filtered, tail-bounded
     readonly waitExitCode: number;
   }

   export interface PaseoUsageEstimate {
     // From `paseo inspect <id> --json`. Optional — best-effort.
     readonly inputTokens?: number;
     readonly outputTokens?: number;
     readonly costUsd?: number;
   }

   export interface PaseoCliClient {
     spawnAgent(spec: PaseoAgentSpec): Promise<PaseoAgentSession>;
     sendPrompt(agentId: string, prompt: string): Promise<void>;
     waitIdle(agentId: string, timeoutSec: number): Promise<{ exitCode: number }>;
     readTranscript(agentId: string, tailLines: number): Promise<string>;
     usageEstimate(agentId: string): Promise<PaseoUsageEstimate>;
     deleteAgent(agentId: string): Promise<void>;  // best-effort
   }

   export function makePaseoCliClient(deps: {
     bin?: string;                  // default 'paseo'
     host?: string;                 // optional --host
     cwd: string;                   // working dir for spawned processes
     processSpawn?: typeof spawn;   // injectable for tests (default node:child_process spawn)
     timeoutDefaultSec?: number;    // default 60
   }): PaseoCliClient;
   ```

   Implementation notes:
   - Long prompts go through a temp file via
     `paseo send --no-wait --prompt-file <path>` (mirrors v1.6 client).
   - Transcript reading uses `paseo logs --filter text --tail <N>`.
     `<N>` defaults to 200; the adapter requests only the diff since
     the previous read by tracking the last-seen suffix length.
   - `waitIdle` returns the exit code WITHOUT throwing so the adapter
     can distinguish timeout (non-zero) from completion (zero).
   - `deleteAgent` swallows failures; cleanup is best-effort.
   - `usageEstimate` parses `paseo inspect <id> --json`'s `LastUsage`
     field if present; missing usage is acceptable (returns `{}`).

2. **PaseoRuntimeAdapter (Paseo-specific sub-interface).**

   `packages/pluto-v2-runtime/src/adapters/paseo/paseo-adapter.ts`

   Implements **`PaseoRuntimeAdapter<S>`**, a Paseo-specific
   sub-interface that **extends** S4's closed `RuntimeAdapter<S>`
   without mutating it. The base `init`/`step` surface stays
   byte-identical to S4 table E. The sub-interface adds two
   pure-state methods that the driver inspects to decide whether to
   make a paseo CLI round-trip BEFORE the next `step`:

   ```ts
   import type { RuntimeAdapter, KernelView } from '../../runtime/runtime-adapter.js';
   import type { ActorRef } from '@pluto/v2-core';

   export interface PaseoTurnRequest {
     readonly actor: ActorRef;
     readonly prompt: string;       // built by adapter from transcript + system prompt
   }

   export interface PaseoTurnResponse {
     readonly actor: ActorRef;
     readonly transcriptText: string;
     readonly usage: PaseoUsageEstimate;
   }

   export interface PaseoRuntimeAdapter<S> extends RuntimeAdapter<S> {
     /** Returns the next paseo turn iff the adapter is "awaiting model".
      *  Pure inspection — does NOT mutate state. */
     pendingPaseoTurn(state: S, view: KernelView): PaseoTurnRequest | null;

     /** Folds a paseo response into a new state. Pure; sync. */
     withPaseoResponse(state: S, response: PaseoTurnResponse): S;
   }
   ```

   This is **strictly additive** at the type level: S4 `RuntimeAdapter`
   is unchanged, S4 `runScenario` (which only knows `init`/`step`)
   keeps working with any non-Paseo adapter. The Paseo driver
   (`runPaseo`, deliverable 3) knows how to call the two extension
   methods in the right order.

   Closed `PaseoAdapterState`:

   ```ts
   export interface PaseoAdapterState {
     readonly turnIndex: number;
     readonly maxTurns: number;
     readonly currentActor: ActorRef;
     readonly transcriptByActor: ReadonlyMap<string /* actorKey */, ReadonlyArray<{
       role: 'system' | 'user' | 'assistant';
       content: string;
     }>>;
     readonly awaitingResponseFor: ActorRef | null;
     readonly bufferedResponse: PaseoTurnResponse | null;
     readonly parseFailureCount: number;   // for the current actor's pending request
     readonly maxParseFailuresPerTurn: number;  // default 2
   }
   ```

   Adapter behavior summary:

   - `init(teamContext, view)` → initial state with `turnIndex = 0`,
     `currentActor = <lead role from teamContext>`,
     `awaitingResponseFor = null`, `bufferedResponse = null`,
     `transcriptByActor = { lead: [<system prompt>] }`, etc.
   - `pendingPaseoTurn(state, view)` → if
     `awaitingResponseFor === null && bufferedResponse === null &&
     turnIndex < maxTurns`, build the next prompt for `currentActor`
     from `transcriptByActor[currentActor]` and return
     `{ actor, prompt }`. Otherwise `null`.
   - `withPaseoResponse(state, response)` → return a new state with
     `bufferedResponse = response`, `awaitingResponseFor = null`,
     append the assistant message to `transcriptByActor[response.actor]`.
   - `step(state, view)`:
     - If `bufferedResponse !== null`: parse it via
       `PaseoDirectiveSchema` (deliverable 4), construct the
       corresponding `ProtocolRequest`, advance `turnIndex`, reset
       `bufferedResponse`, rotate `currentActor` per the playbook.
       Return `{ kind: 'request', request, nextState }`.
     - If parse fails: append the parse error to the actor's
       transcript, increment `parseFailureCount`. If
       `parseFailureCount > maxParseFailuresPerTurn`: return
       `{ kind: 'done', completion: { status: 'failed', summary:
       'parse failure budget exhausted for actor X at turn Y' },
       nextState }`. Otherwise reset `bufferedResponse` to null and
       set `awaitingResponseFor = currentActor` (driver will fire
       another paseo turn on the next outer iteration).
     - If `turnIndex >= maxTurns`: return `{ kind: 'done',
       completion: { status: 'failed', summary: 'maxTurns exhausted' },
       nextState }`.
     - If a previous parsed directive was `complete_run`: return
       `{ kind: 'done', completion: <from directive> }`.
     - Else (no buffered response, no completion): the driver MUST
       have called `pendingPaseoTurn` first; reaching `step` in this
       state is a bug. Throw a typed `PaseoAdapterStateError`.

3. **runPaseo driver (async sibling of runFake).**

   `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`

   ```ts
   export async function runPaseo<S>(
     authored: AuthoredSpec,
     adapter: PaseoRuntimeAdapter<S>,
     options: {
       client: PaseoCliClient;
       idProvider: IdProvider;
       clockProvider: ClockProvider;
       paseoAgentSpec: (actor: ActorRef) => PaseoAgentSpec;  // map role → provider/model/mode
       correlationId?: string | null;
       maxSteps?: number;          // default 1000; counts step phases ONLY
       waitTimeoutSec?: number;    // default 600
     },
   ): Promise<{
     events: ReadonlyArray<RunEvent>;
     views: ProjectionViews;
     evidencePacket: EvidencePacket;
     usage: {
       totalInputTokens: number;
       totalOutputTokens: number;
       totalCostUsd: number;
       byActor: ReadonlyMap<string /* actorKey */, {
         turns: number;
         inputTokens: number;
         outputTokens: number;
         costUsd: number;
       }>;
       perTurn: ReadonlyArray<{
         turnIndex: number;
         actor: ActorRef;
         inputTokens: number;
         outputTokens: number;
         costUsd: number;
         waitExitCode: number;
       }>;
     };
   }>;
   ```

   Algorithm (re-implemented; does NOT call S4's `runScenario`):

   ```text
   1. teamContext = compileTeamContext(authored)
   2. kernel = new RunKernel({ initialState: initialState(teamContext),
                                idProvider, clockProvider })
   3. kernel.seedRunStarted({ scenarioRef, runProfileRef,
                              startedAt: clockProvider.nowIso() })
   4. let s = adapter.init(teamContext, kernelViewOf(kernel))
   5. const agentByActorKey = new Map<string, string>()  // ActorRef → agentId
      const usage = empty accumulator
      let stepCount = 0
   6. loop indefinitely:
        // -- model phase (does NOT consume stepCount)
        const turn = adapter.pendingPaseoTurn(s, kernelViewOf(kernel))
        if turn !== null:
          const actorKey = actorKeyOf(turn.actor)
          let agentId = agentByActorKey.get(actorKey)
          if agentId === undefined:
            const session = await client.spawnAgent(
              options.paseoAgentSpec(turn.actor))
            agentId = session.agentId
            agentByActorKey.set(actorKey, agentId)
          const lastSeenLen = transcriptLengthBefore(s, turn.actor)
          await client.sendPrompt(agentId, turn.prompt)
          const wait = await client.waitIdle(agentId, options.waitTimeoutSec)
          const fullText = await client.readTranscript(agentId, 200)
          const newSlice = fullText.slice(lastSeenLen)
          const usageEst = await client.usageEstimate(agentId)
          usage.accumulate({ turn: s.turnIndex, actor: turn.actor,
                              waitExitCode: wait.exitCode, ...usageEst })
          s = adapter.withPaseoResponse(s, {
            actor: turn.actor, transcriptText: newSlice, usage: usageEst
          })
          continue   // re-check pendingPaseoTurn before stepping
        // -- step phase (consumes stepCount)
        if stepCount >= (options.maxSteps ?? 1000):
          throw new RunNotCompletedError('maxSteps exceeded')
        stepCount += 1
        const step = adapter.step(s, kernelViewOf(kernel))
        if step.kind === 'done':
          // build complete_run with manager actor
          kernel.submit({
            requestId: idProvider.next(),
            runId: kernel.state.runId,
            schemaVersion: SCHEMA_VERSION,
            actor: { kind: 'manager' },
            intent: 'complete_run',
            payload: step.completion,
            idempotencyKey: null,
          }, { correlationId: options.correlationId ?? null })
          s = step.nextState
          break
        kernel.submit(step.request, { correlationId: options.correlationId ?? null })
        s = step.nextState
   7. // best-effort cleanup
      for [, agentId] of agentByActorKey: await client.deleteAgent(agentId)
   8. const events = stripAcceptedRequestKey(kernel.eventLog.read(0, kernel.eventLog.head + 1))
      // matches runScenario's public event-shape contract — see runner.ts:64-68
   9. const views = replayAll(events)
      const evidencePacket = assembleEvidencePacket(views, events, kernel.state.runId)
      return { events, views, evidencePacket, usage: usage.finalize() }
   ```

   Key invariants:
   - **Model phase does NOT consume `maxSteps`.** Only `step` calls do.
   - **`maxTurns` is owned by the adapter** (`PaseoAdapterState.maxTurns`)
     and surfaces as a `done.completion.status='failed'` when exhausted.
   - **`runPaseo` events match `runScenario`'s public event-shape**:
     `acceptedRequestKey` is stripped before return (call into the
     same helper used by S4's `runner.ts` if exposed; otherwise
     reimplement the strip locally — it is one line).
   - **Best-effort cleanup**: `deleteAgent` failures are swallowed.
   - **No HTTP** anywhere. All paseo communication is via CLI.

4. **Structured-output protocol.**

   `packages/pluto-v2-runtime/src/adapters/paseo/paseo-directive.ts`

   The adapter parses each LLM response into one of a closed set of
   directives. The protocol is enforced by the system prompt and a
   JSON-schema instruction in the user-message footer. v1.0 uses
   client-side Zod parse with bounded re-prompting; provider-enforced
   JSON schema (e.g. OpenAI `response_format: { type: 'json_schema' }`)
   is DEFERRED to S5+ to avoid provider lock-in (Paseo is the
   abstraction).

   Closed directive grammar (Zod):

   ```ts
   import {
     MailboxMessageAppendedPayloadSchema,
     TaskCreatedPayloadSchema,
     TaskStateChangedPayloadSchema,
     ArtifactPublishedPayloadSchema,
     RunCompletedPayloadSchema,
   } from '@pluto/v2-core';

   export const PaseoDirectiveSchema = z.discriminatedUnion('kind', [
     z.object({ kind: z.literal('append_mailbox_message'),
                payload: MailboxMessageAppendedPayloadSchema.omit({ messageId: true }) }),
     z.object({ kind: z.literal('create_task'),
                payload: TaskCreatedPayloadSchema.omit({ taskId: true }) }),
     z.object({ kind: z.literal('change_task_state'),
                payload: TaskStateChangedPayloadSchema.omit({ from: true }) }),
     z.object({ kind: z.literal('publish_artifact'),
                payload: ArtifactPublishedPayloadSchema.omit({ artifactId: true }) }),
     z.object({ kind: z.literal('complete_run'),
                payload: RunCompletedPayloadSchema.omit({ completedAt: true }) }),
   ]);

   export function extractDirective(text: string):
     | { ok: true; directive: PaseoDirective }
     | { ok: false; reason: string };
   ```

   The extractor:
   - Searches for a fenced ```json ... ``` block (preferred) or the
     first balanced JSON object in the text.
   - Parses via `PaseoDirectiveSchema`.
   - Returns `{ ok: false, reason }` on any failure (no JSON block
     found / JSON parse error / Zod validation error). The adapter
     uses `reason` to compose the next user message asking for a
     correctly-formatted directive.

5. **Pure invariants.**

   - PaseoCliClient is the ONLY place under `packages/pluto-v2-runtime/src/**`
     that may import `node:child_process`. Acceptance grep enforces.
   - NO HTTP imports anywhere under `packages/pluto-v2-runtime/src/**`
     (`node:http`, `node:https`, `fetch(` direct usage). v2 talks to
     paseo only via CLI.
   - PaseoCliClient and runPaseo are async; **`PaseoRuntimeAdapter.step`
     stays sync** (S4 contract).
   - All ID generation goes through injected `idProvider`; all
     timestamps go through injected `clockProvider`.

6. **Tests.**

   Under `packages/pluto-v2-runtime/__tests__/adapters/paseo/`:

   - `paseo-cli-client.test.ts` — inject a mock `processSpawn`; happy
     path constructs the correct argv for each method (`run`/`send`/
     `wait`/`logs`/`ls`/`delete`); spawn failure → typed error;
     `waitIdle` returns exit code without throwing on non-zero;
     `deleteAgent` swallows failures.
   - `paseo-directive.test.ts` — `extractDirective` round-trips for
     each of the 5 directive kinds (with fenced JSON block); rejects
     missing JSON block, malformed JSON, schema-invalid payload;
     prefers fenced block over inline JSON.
   - `paseo-adapter.test.ts` — `step` is sync; `pendingPaseoTurn`
     returns non-null only when awaiting; `withPaseoResponse` is
     pure; given a stubbed `bufferedResponse`, `step` emits the
     expected ProtocolRequest; deterministic given fixed providers;
     parse-failure recovery counts against
     `maxParseFailuresPerTurn`; surfaces `done` with `status='failed'`
     when exhausted.
   - `run-paseo.test.ts` — `runPaseo(hello-team, mockAdapter, {
     client: mockClient })` end-to-end with a deterministic mock
     `PaseoCliClient` that returns scripted transcripts; events
     match `expected-events.jsonl`; evidence packet matches
     `expected-evidence-packet.json`; `usage.byActor` and
     `usage.perTurn` populate correctly; model phases do NOT consume
     `maxSteps`.

   New deterministic mock-transport fixture:
   `packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/{scenario.yaml, mock-script.json, expected-events.jsonl, expected-evidence-packet.json}`.

   `mock-script.json` is a sequence of scripted paseo CLI responses
   keyed by `(turnIndex, actor)`. Each entry has:

   ```ts
   {
     turnIndex: number,
     actor: ActorRef,
     transcriptText: string,        // raw assistant text including a fenced ```json
                                    // block matching PaseoDirectiveSchema
     usage: { inputTokens, outputTokens, costUsd },
     waitExitCode: 0,
   }
   ```

   The mock `PaseoCliClient.spawnAgent` returns deterministic
   `agentId = 'mock-<role>'`. `sendPrompt` is a no-op.
   `waitIdle` returns `{ exitCode: scripted.waitExitCode }`.
   `readTranscript` returns the cumulative `transcriptText` for the
   actor's prior + current turn. `usageEstimate` returns the
   scripted usage. The mapping from `mock-script.json` to
   `expected-events.jsonl` is **mechanical**: each scripted directive
   becomes one v2 ProtocolRequest, which becomes one v2 RunEvent
   per the kernel's normal `submit` path.

   Total S5 unit-test count: ≥ 16 across the 4 test files.

   **Live smoke (gated by env, runs ONCE per slice — R8):**

   `pnpm smoke:live` invokes `runPaseo(hello-team-real, adapter,
   options)` against a real Paseo daemon on a small/cheap model
   (e.g. `openai/gpt-4o-mini` or equivalent — bounded by `runProfile`
   in the authored spec). The captured artifacts are saved under
   `tests/fixtures/live-smoke/<newRunId>/` and committed in the slice
   branch.

   Captured artifacts:
   - `events.jsonl` (v2 `RunEvent[]` from `kernel.eventLog`)
   - `evidence-packet.json` (v2 EvidencePacketShape)
   - `final-report.md` (rendered from EvidenceProjectionView)
   - `usage-summary.json` (totals + per-actor + per-turn)
   - `paseo-transcripts/<actorKey>.txt` (raw paseo logs per role)

   Live-smoke acceptance:
   - Total turns ≤ 20.
   - Total cost ≤ $0.50 (tracked via `usage.totalCostUsd`).
   - Run reaches `run_completed` (status `'succeeded'` OR `'failed'`,
     either is acceptable; it must not throw `RunNotCompletedError`).
   - `replayAll(events)` succeeds; `assembleEvidencePacket` produces
     a packet that parses through `EvidencePacketShape`.
   - `commit_and_push` happens **only after** smoke:live exits 0
     AND all captured artifacts exist on disk. If smoke:live fails,
     the slice is BLOCKED — do NOT commit a partial fixture.

7. **Out of scope for S5.**

   - CLI changes (S6).
   - v1.6 file-lineage edits (the v1.6 paseo client is a reference
     oracle, not a dependency).
   - Multi-run live smoke (R8: ONCE per slice).
   - Streaming responses.
   - Tool-use / function-calling (deferred; v1.0 directive grammar
     is closed at the 5 v2 intents).
   - HTTP transport to paseo (paseo daemon does not expose a
     completion endpoint; this slice does not add one).
   - Provider-side JSON-schema enforcement (deferred to avoid
     provider lock-in).
   - **No row-by-row parity test** between the new v2 live-smoke
     fixture and the v1.6 fixture `86557df1-...`. The two are
     fundamentally different runtime semantics; the live-smoke
     fixture is evidence-only, NOT a parity gate.

8. **S5 dependency graph.**

   S5 imports `@pluto/v2-core` (read-only) and `@pluto/v2-runtime`'s
   own `runtime/`/`loader/`/`evidence/` modules. NO S1/S2/S3/S4
   mutations.

### S5 acceptance bar

- **Package-scoped typecheck** for both v2-core and v2-runtime: clean.
- **Package-scoped vitest** for both: green; v2-runtime adds ≥ 16 unit
  tests (4 new test files); total v2-runtime tests ≥ 45 (S4) + 16 = 61.
- **Package-scoped build** for both: clean.
- **Root regression** `pnpm test`: green.
- **Live smoke**: ONE captured fixture under
  `tests/fixtures/live-smoke/<newRunId>/`. `usage-summary.json`
  records totals + per-actor + per-turn. Within bounds (≤ 20 turns,
  ≤ $0.50 cost, reaches `run_completed`).
- **No-runtime-leak grep refinement**: paseo / opencode / claude
  allowed ONLY under `packages/pluto-v2-runtime/src/adapters/paseo/**`.
  Every other v2-runtime path stays clean.
- **No-HTTP grep**: `node:http` / `node:https` / direct `fetch(` MUST
  NOT appear under `packages/pluto-v2-runtime/src/**` at all
  (v2 talks to paseo via CLI only). Test directories are NOT scoped
  by this grep.
- **No-process-spawn-outside-cli-client grep**: `child_process` may
  be imported ONLY in
  `packages/pluto-v2-runtime/src/adapters/paseo/paseo-cli-client.ts`.
- **No-S2/S3/S4-mutation**: `git diff --stat
  main..origin/<branch> --
  packages/pluto-v2-core/ packages/pluto-v2-runtime/src/{runtime,loader,evidence,legacy}`
  reports zero changes outside the new `adapters/paseo/` subtree.
- **Diff hygiene**: scope confined to
  - `packages/pluto-v2-runtime/src/adapters/paseo/**`
  - `packages/pluto-v2-runtime/__tests__/adapters/paseo/**`
  - `packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/**`
  - `tests/fixtures/live-smoke/<newRunId>/**` (the live-smoke capture)
  - `packages/pluto-v2-runtime/src/index.ts` (additive re-exports)
  - `package.json` (additive `smoke:live` script if missing)
  - `docs/design-docs/v2-paseo-adapter.md` (new)
  - `docs/plans/active/v2-rewrite.md` — S5 status row only.
- **Branch is committed AND pushed**: `commit_and_push` step. **S5
  binding addition**: commit_and_push runs ONLY after smoke:live
  exits 0 AND the live-smoke fixture/usage-summary artifacts exist.
- A reviewer sub-agent confirms (a) `PaseoRuntimeAdapter` matches
  S4 table E byte-for-byte at the base interface (sync surface),
  (b) `PaseoCliClient` is the only `child_process` user, (c)
  `runPaseo` does not modify S4 `runScenario` or the kernel and
  produces events that match `runScenario`'s public event shape
  (no `acceptedRequestKey`), (d) live-smoke fixture is well-formed
  and bounded, (e) no S2/S3/S4 surface mutations, (f) per-turn /
  per-actor usage diagnostics are emitted in `usage-summary.json`.

## S6 — Phase 6: Switch `pluto:run` CLI default to v2 (next slice)

### Outcome

Flip the `pnpm pluto:run` CLI's default runtime from v1.6 to v2. Default
invocation routes through v2's `runPaseo` (via the existing
`@pluto/v2-runtime` workspace). Legacy v1.6 stays present as an opt-in
escape hatch behind a `--runtime=v1` flag (or `PLUTO_RUNTIME=v1` env)
for one transition window — S7 archives v1.6 entirely.

This is the FIRST user-visible behavior change. Operator decision
(2026-05-07): aggressive default switch — v2 fully replaces v1.6 as
the default; v1.6 is the deprecated transition fallback.

### S6 boundary

- New code lives in `src/cli/` (the existing v1.6 CLI surface) AS A
  ROUTING LAYER plus a new `v2-cli-bridge.ts` that adapts v1.6 CLI
  args / flags / output formatting to `runPaseo`'s contract.
- `@pluto/v2-runtime` and `@pluto/v2-core` are READ-ONLY consumers
  for S6 (no S1–S5 surface mutations).
- v1.6 `src/` modules other than `src/cli/` are READ-ONLY in S6 (S7
  archives them).
- The `--runtime=v1` opt-in continues to call the existing v1.6
  manager-run-harness for one transition window.

### Concrete deliverables (revised after discovery R1)

The discovery review surfaced two blockers: (a) v2's loader takes a
file path while v1.6's CLI takes scenario/run-profile/playbook
NAMES; (b) v1.6-only features live in four-layer fields that aren't
in v2's `AuthoredSpecSchema` so Zod-rejection cannot detect them.
Resolution: v2 does NOT synthesize an AuthoredSpec from v1.6's
four-layer pieces. v2 takes a single `--spec=<path>` file. Name-
based selection stays a v1.6-only feature reachable only via
`--runtime=v1`.

1. **CLI flag and runtime selection (revised).**

   - Add `--runtime <v1|v2>` flag to the existing CLI parser. Default
     value is **`v2`**. The flags parser also accepts the inline
     `--runtime=v2` syntax.
   - Also accept `PLUTO_RUNTIME` env var with the same closed values.
   - Precedence: CLI flag > env var > default (v2). Precedence
     enforcement is confined to the CLI router; the bridge does NOT
     re-read `PLUTO_RUNTIME`.
   - When `--runtime=v1`, the CLI emits a one-line **deprecation
     warning** to stderr: "v1.6 runtime is deprecated; will be
     archived in S7. See docs/design-docs/v2-cli-default-switch.md
     for migration." (No date claim beyond "S7".) The warning fires
     exactly once per CLI invocation.
   - Add a new `--spec <path>` flag. Required when `--runtime=v2`
     (or default); points to a v2 `AuthoredSpec` YAML/JSON file.
     Mutually exclusive with v1.6's name-selectors
     (`--scenario` / `--playbook` / `--run-profile`).
   - When `--runtime=v2` (or default) is selected AND v1.6 name-
     selectors are passed without `--spec`, the CLI exits with
     code 1 and stderr message: "v1.6 name-based selection
     (--scenario/--playbook/--run-profile) requires --runtime=v1.
     For v2, pass a single --spec=<path> AuthoredSpec file. v1.6
     will be archived in S7."

2. **`src/cli/v2-cli-bridge.ts` — routing layer (revised).**

   ```ts
   import type { ChildProcess } from 'node:child_process';
   import type { IdProvider, ClockProvider } from '@pluto/v2-core';
   import type {
     PaseoCliClient,
     PaseoRuntimeAdapter,
   } from '@pluto/v2-runtime';

   export interface V2BridgeInput {
     readonly specPath: string;             // resolved from --spec
     readonly workspaceCwd: string;          // existing CLI knows this
     readonly evidenceOutputDir: string;     // = `<dataDir>/runs/<runId>`
     readonly paseoHost?: string;            // env PASEO_HOST passthrough
     readonly paseoBin?: string;             // env PASEO_BIN passthrough
     readonly stderr: NodeJS.WritableStream;
   }

   export interface V2BridgeResult {
     readonly status: 'succeeded' | 'failed' | 'cancelled';
     readonly summary: string | null;
     readonly evidencePacketPath: string;
     readonly transcriptPaths: ReadonlyArray<string>;
     readonly exitCode: 0 | 1 | 2;
   }

   export interface V2BridgeDeps {
     readonly loadAuthoredSpec: typeof loadAuthoredSpec;       // v2-runtime
     readonly runPaseo: typeof runPaseo;                       // v2-runtime
     readonly makePaseoCliClient: typeof makePaseoCliClient;   // v2-runtime
     readonly makePaseoAdapter: typeof makePaseoAdapter;       // v2-runtime
     readonly defaultIdProvider: IdProvider;                   // v2-core
     readonly defaultClockProvider: ClockProvider;             // v2-core
   }

   export async function runViaV2Bridge(
     input: V2BridgeInput,
     deps: V2BridgeDeps,
   ): Promise<V2BridgeResult>;
   ```

   Behavior:
   - Loads the authored spec via `deps.loadAuthoredSpec(input.specPath)`.
     If the file is missing or fails Zod validation, exit 1 with the
     loader's error message.
   - Synthetic `paseoAgentSpec(actor)` defaults — provider
     `opencode`, model `openai/gpt-5.4-mini`, mode `build`, title
     `pluto-${actorKey}`, labels `["slice=v2-cli"]`, initialPrompt
     synthesized from a static system prompt per actor role. Env
     overrides: `PASEO_PROVIDER`, `PASEO_MODEL`, `PASEO_MODE`,
     `PASEO_THINKING`. The bridge does NOT read these from
     `runProfile` (run-profile YAML files don't carry these fields
     in v1.6).
   - Calls `runPaseo(authored, makePaseoAdapter(...), { client,
     idProvider, clockProvider, paseoAgentSpec, waitTimeoutSec: 600 })`.
   - Wraps any thrown errors via `classifyPaseoError(err)` (deliverable
     3) to map paseo binary / capability failures to exit code 2.
   - Writes the v2 `EvidencePacket` to
     `<evidenceOutputDir>/evidence-packet.json` (PATH continuity
     with v1.6; JSON SHAPE is the new v2 shape — documented break,
     see deliverable 7).
   - Writes per-actor transcripts to
     `<evidenceOutputDir>/paseo-transcripts/<actorKey>.txt`.
   - Returns `V2BridgeResult` with `exitCode 0` on success, `1` on
     parse / runtime errors, `2` on paseo capability failures.

3. **`classifyPaseoError(err)` — exit-code-2 compatibility shim.**

   `src/cli/v2-cli-bridge-error.ts`

   The existing `tests/cli/run-exit-code-2.test.ts` asserts that the
   CLI exits with code `2` when paseo's chat-transport capability is
   unavailable (e.g. `PASEO_BIN` points at a non-existent binary).
   v2's `runPaseo` throws generic errors. The shim:

   ```ts
   export type PaseoErrorClass =
     | 'capability_unavailable'      // -> exit 2 (matches v1)
     | 'spec_invalid'                 // -> exit 1
     | 'run_not_completed'            // -> exit 1
     | 'agent_failed_to_start'        // -> exit 1
     | 'unknown';                     // -> exit 1

   export function classifyPaseoError(err: unknown): PaseoErrorClass;
   ```

   Detection rules (closed at v1.0):
   - `capability_unavailable` if ANY of:
     - The error is a raw `spawn ENOENT` (Node's
       `child_process.spawn` fails before `paseo run` itself runs;
       this is the case `tests/cli/run-exit-code-2.test.ts` exercises
       via `PASEO_BIN=/definitely/missing/paseo`). Detect via
       `(err as NodeJS.ErrnoException).code === 'ENOENT'` OR
       `err.message.includes('spawn') && err.message.includes('ENOENT')`.
     - The error message matches `paseo run failed with exit code`
       AND stderr contains `command not found` / `ENOENT` /
       `not executable` (the post-spawn missing-binary case).
     - OR `Failed to spawn paseo CLI` / `EACCES` permission
       failure on the paseo binary.
   - `spec_invalid` if Zod parse error from `loadAuthoredSpec`.
   - `run_not_completed` if `RunNotCompletedError`.
   - `agent_failed_to_start` if error message contains
     "Agent ... failed to start".
   - `unknown` for everything else.

4. **Unsupported-scenario detection (revised).**

   v1.6-only features cannot be detected from v2's strict
   `AuthoredSpecSchema` (those features are FIELDS THAT WOULD BE
   REJECTED if present). So the strategy is structural:

   - The v2 AuthoredSpec format does NOT have v1.6 four-layer
     fields (worktree, approvalGates, concurrency,
     runtime.dispatchMode, helperCli, runtimeHelpers, teamleadChat).
     If a user wrote those into a `--spec=<path>` YAML, Zod parse
     fails → exit 1 with message including "v2 AuthoredSpec does
     not support v1.6-only field <field>; use --runtime=v1 for
     legacy specs."
   - For users who pass v1.6 NAME-SELECTORS without `--spec`, the
     CLI router rejects upfront with the deliverable-1 error
     message — no resolution attempted.

   Bridge does NOT enumerate v1.6 fields explicitly. The strict
   Zod schema does that for us; the user-facing error message
   surfaces the field name from Zod.

5. **Scripts changes.**

   - Root `package.json`'s `"pluto:run"` script body unchanged at
     the script level; behavior changes via the new flag default.
   - Add convenience script `"pluto:run:v1"` that invokes
     `pluto:run --runtime=v1` for users who want the legacy path
     without typing the flag.
   - The flags parser at `src/cli/shared/flags.ts` MUST be extended
     to support `--flag=value` inline syntax (currently only split-
     token `--flag value` works). This is a small additive change.

6. **Tests (revised).**

   Under `tests/cli/`:
   - `run-runtime-v2-default.test.ts` — `pluto:run --spec
     packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/scenario.yaml`
     (no `--runtime` flag → defaults to v2) exits 0 with mock paseo
     client; evidence packet written to expected path; per-actor
     transcripts present.
   - `run-runtime-v1-opt-in.test.ts` — `pluto:run --runtime=v1
     --scenario hello-team --playbook research-review --run-profile fake-smoke`
     invokes the legacy v1.6 manager-run-harness; deprecation
     warning printed to stderr exactly once; CLI exits 0.
   - `run-runtime-precedence.test.ts` — flag > env var > default;
     all three combinations exercised.
   - `run-unsupported-scenario.test.ts` — two paths:
     - User passes `--scenario foo` without `--spec` and no
       `--runtime=v1` → exit 1 with the documented stderr.
     - User passes a `--spec=<path>` YAML containing a v1.6-only
       field (e.g. `helperCli`) → Zod fails → exit 1 with field-
       name in stderr.
   - `run-exit-code-2-v2.test.ts` — `pluto:run --spec=<path>` with
     `PASEO_BIN=/nonexistent` exits with code 2 via the shim.

   Existing `tests/cli/run.test.ts` and `run-exit-code-2.test.ts`
   ARE updated additively to pass `--runtime=v1` explicitly. This
   is a documented change to the test surface, NOT a v1.6 behavior
   change.

   Total S6 test count: ≥ 8 new tests across 5 new files; existing
   2 v1.6 CLI tests updated to pass `--runtime=v1`.

7. **Pure invariants + documented breaks.**

   - The bridge's only I/O entry points are the v2 loader (file
     read) and the paseo CLI (process spawn) and the
     `evidence-packet.json` / transcript writes.
   - **Documented break**: the JSON shape of `evidence-packet.json`
     changes from v1.6's four-layer shape to v2's
     `EvidencePacketShape`. Tooling that reads the v1.6 shape will
     break. Documented in `docs/design-docs/v2-cli-default-switch.md`;
     migration window is until S7 archives v1.6.
   - No S1–S5 source mutations.
   - v1.6 src/ mutations limited to `src/cli/**` only.

8. **Docs.**

   - `docs/design-docs/v2-cli-default-switch.md` (new) — explains
     routing, the `--spec` requirement, the closed
     `classifyPaseoError` rules, the documented JSON-shape break,
     and the deprecation timeline (S6 ships → S7 archives).
   - `README.md` (additive note about `--runtime=v1` opt-in).
   - `docs/plans/active/v2-rewrite.md` — S6 status row + this
     deliverables revision.
### Out of scope for S6

- Archiving / removing v1.6 mainline runtime (S7).
- Changing v1.6's CLI surface (flags, output format) — those carry
  forward unchanged.
- Adding v2 support for v1.6-only scenarios (separate slices).
- Live-smoke as a CLI gate (S5 captured the binding fixture; S6 just
  routes).

### S6 dependency graph

S6 imports `@pluto/v2-runtime` and `@pluto/v2-core` (read-only) plus
the existing v1.6 CLI's `RunOptions` parser. NO mutations to v1–v5
surface.

### S6 acceptance bar

- **Package-scoped typecheck** for v2-core, v2-runtime, AND root
  `tsc -p tsconfig.json --noEmit` (which includes `src/cli/`):
  all clean.
- **`pnpm test`** root regression green: existing 737 tests + ≥ 8
  S6 tests (target ≥ 745).
- **`pluto:run` defaults to v2**: sanity test runs `pluto:run --spec
  packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/scenario.yaml`
  against a mock paseo client and asserts evidence-packet path
  continuity (`<dataDir>/runs/<runId>/evidence-packet.json`) plus
  exit code 0.
- **`--runtime=v1` opt-in works**: sanity test runs `pluto:run
  --runtime=v1 --scenario hello-team --playbook research-review
  --run-profile fake-smoke` against the legacy v1.6 manager-run-
  harness; deprecation warning hits stderr exactly once.
- **`--spec` requirement enforced**: when default-v2 is selected and
  v1.6 name-selectors are passed without `--spec`, CLI exits with
  code 1 and the documented stderr message.
- **Exit-code-2 shim works**: `tests/cli/run-exit-code-2-v2.test.ts`
  exercises `PASEO_BIN=/nonexistent` and asserts exit code 2 via
  `classifyPaseoError`. Existing v1.6 `run-exit-code-2.test.ts`
  continues to pass with `--runtime=v1`.
- **AuthoredSpec strict-Zod rejects v1.6-only fields**: a test
  passes a `--spec=<path>` YAML with `helperCli` (or any v1.6 four-
  layer field) and asserts exit 1 with the field name in stderr.
- **Flags parser supports `--flag=value`**: tested by both v1 and
  v2 paths.
- **No S1–S5 mutation**: `git diff --stat main..origin/<branch> --
  packages/` reports zero changes.
- **No v1.6 src/ mutation outside `src/cli/`**: enforced by diff
  hygiene.
- **Diff hygiene**: scope confined to
  - `src/cli/v2-cli-bridge.ts` (new)
  - `src/cli/v2-cli-bridge-error.ts` (new)
  - `src/cli/run.ts` (additive runtime-flag + spec-flag routing)
  - `src/cli/shared/flags.ts` (additive `--flag=value` syntax)
  - `src/cli/shared/run-selection.ts` (additive — if needed for
    v1 vs v2 selection routing; otherwise read-only)
  - 5 new test files under `tests/cli/`
  - existing 2 v1.6 CLI test files updated additively to pass
    `--runtime=v1`
  - root `package.json` (additive `pluto:run:v1` script)
  - `docs/design-docs/v2-cli-default-switch.md` (new)
  - `README.md` (additive deprecation note)
  - `docs/plans/active/v2-rewrite.md` — S6 status row + any in-slice
    contract refinements (per the gate-11 widening from S5).
  - `tasks/remote/pluto-v2-s6-cli-default-switch-20260507/**` (bundle
    docs).
- **Branch is committed AND pushed**: `commit_and_push` step.
- A reviewer sub-agent confirms: (a) default flag is `v2`, (b)
  precedence flag > env > default, (c) `--runtime=v1` works and
  emits exactly one deprecation warning, (d) Zod-rejection of v1.6-
  only fields produces exit 1 with the field name, (e) exit-code-2
  shim preserves the legacy contract, (f) JSON-shape break is
  documented, (g) no v1–v5 surface mutations.

## S7 — Phase 7: Archive legacy mainline runtime code (final slice)

### Outcome

Remove ALL v1.6 surface from `main`. The frozen reference copy
lives on the `legacy-v1.6-harness-prototype` branch on origin
(created in S0; SHA documented at `docs/plans/active/v2-rewrite.md`
line 97-104). Future readers reach v1.6 by checking out that branch.

`main` becomes v2-only end-to-end. Per operator's binding rule
"every v2 vs v1.6 decision goes aggressive replacement; v1.6 stays
only as reference," S7 deletes EVERY v1.6 surface that has a v2
equivalent or is no longer needed:

- v1.6 runtime sources (`src/orchestrator/`, `src/four-layer/`,
  `src/adapters/paseo-opencode/`, etc.).
- v1.6 auxiliary CLI commands (`pluto:package`, `pluto:runs`,
  `pluto:submit` and their `src/cli/` modules).
- v1.6 build / verify / smoke infrastructure (`docker/live-smoke.ts`,
  `scripts/verify.mjs`'s v1 dispatch path, `src/index.ts` v1
  exports).
- All v1.6 tests under `tests/` (`manager-run-harness`,
  `paseo-opencode-adapter`, `prompt-collar`, `four-layer-*`,
  etc.).
- All v1.6 authored configs (`scenarios/`, `playbooks/`,
  `run-profiles/`, `agents/`, `evals/`) — none of these are loaded
  by retained code; v2 takes only `--spec=<path>`.
- All v1.6 doc references across the 9 docs identified by
  discovery R1.

This is the FINAL slice of the v2 rewrite. After S7 ships, `main`
is fully v2.

### Reference branch (binding)

Archive branch on origin: **`legacy-v1.6-harness-prototype`**.
(Discovery R1 confirmed via `git ls-remote`; the earlier plan name
`legacy/v1.6-runtime` was a typo.)

### Boundary

Aggressive deletion. Reference recovery from
`legacy-v1.6-harness-prototype` is git-cheap. v2 packages
(`packages/pluto-v2-core/**`, `packages/pluto-v2-runtime/**`) and
the parity fixture (`tests/fixtures/live-smoke/86557df1-...`) are
UNTOUCHED.

### Concrete deliverables

1. **Lane 0 — Inventory of retained vs deleted (read-only audit).**

   Produce
   `tasks/remote/pluto-v2-s7-archive-legacy-20260508/artifacts/v1.6-inventory.md`
   BEFORE any deletion. The inventory enumerates EVERY file under
   `src/`, `tests/`, `scripts/`, `docker/`, `scenarios/`,
   `playbooks/`, `run-profiles/`, `agents/`, `evals/` and labels
   each as **KEEP**, **DELETE**, or **REWRITE**.

   Retained-entrypoint set used to derive the import graph:

   - `src/cli/run.ts` (v2 only, post-surgery).
   - `src/cli/v2-cli-bridge.ts` / `v2-cli-bridge-error.ts`.
   - `src/cli/shared/flags.ts` / `run-selection.ts`.
   - `packages/pluto-v2-core/**`.
   - `packages/pluto-v2-runtime/**`.
   - `tests/fixtures/live-smoke/86557df1-...` (parity oracle data;
     not code).
   - `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`,
     `pnpm-workspace.yaml`, root `package.json` (post-script
     cleanup).
   - Any v2-only test under `tests/cli/run-runtime-*.test.ts`,
     `run-exit-code-2-v2.test.ts`, `run-unsupported-scenario.test.ts`
     (rewritten per deliverable 4).

   Inventory mechanism: `tsc --listFiles -p tsconfig.json` filtered
   to `src/`, `tests/`, `docker/`, `scripts/`. Files NOT emitted by
   `tsc --listFiles` from the retained entrypoints are DELETE
   candidates. Cross-check against `package.json` script references
   and Vitest include patterns.

2. **Removed v1.6 surface (binding list — applied AFTER inventory
   confirms reachability).**

   **Scope expansion (R3 update, 2026-05-08):** Lane 0 inventory
   on `3a931fd` revealed the v1.6 surface under `src/` is much
   wider than the original list (211 TS files across 27 subdirs;
   only `src/cli/{run,v2-cli-bridge}.ts` import the v2 packages).
   Per operator's binding rule "always aggressive full v2
   replacement", the deletion list expands to **every src/
   subdirectory NOT in the retained-entrypoint set**.

   Source code (entire directories deleted — full v1.6 product
   surface, not just runtime):

   v1.6 runtime trees:
   - `src/adapters/` (paseo-opencode + fake; v2 equivalents live
     in `packages/pluto-v2-runtime/src/adapters/`).
   - `src/four-layer/` — v1.6 four-layer.
   - `src/orchestrator/` — v1.6 manager-run-harness etc.
   - `src/contracts/` — v1.6 contract types (v2 equivalents in
     `packages/pluto-v2-core/src/`).
   - `src/runtime/` — v1.6 runtime helpers.

   v1.6 broader product surface (cascading deletion required by
   `src/contracts/` removal; all chain off v1.6 contracts):
   - `src/audit/`, `src/bootstrap/`, `src/catalog/`,
     `src/compliance/`, `src/evidence/`, `src/extensions/`,
     `src/governance/`, `src/identity/`, `src/integration/`,
     `src/observability/`, `src/ops/`, `src/portability/`,
     `src/portable-workflow/`, `src/publish/`, `src/release/`,
     `src/review/`, `src/schedule/`, `src/security/`,
     `src/storage/`, `src/store/`, `src/versioning/`.
   - Any other `src/<subdir>/` discovered by lane 0 NOT in the
     retained-entrypoint set.

   The v2 product surface lives entirely under
   `packages/pluto-v2-core/` and `packages/pluto-v2-runtime/`.
   Any feature from the broader v1.6 product surface that needs
   to live on `main` post-S7 is a SEPARATE post-merge slice with
   v2-shaped re-implementation. Recovery from
   `legacy-v1.6-harness-prototype` is git-cheap.

   v1.6 auxiliary CLI commands (entire files deleted):
   - `src/cli/package.ts` (`pluto:package` command).
   - `src/cli/runs.ts` (`pluto:runs` command).
   - `src/cli/submit.ts` (`pluto:submit` command).
   - Any other `src/cli/*.ts` not in the retained-entrypoint list.

   v1.6 build / verify / smoke infrastructure:
   - `docker/live-smoke.ts` — v1.6 live-smoke harness; replaced by
     `packages/pluto-v2-runtime/scripts/smoke-live.ts` from S5.
   - `scripts/verify.mjs` — v1.6 verify pipeline. Either rewrite
     to a v2-only verify (preferred) or delete entirely. Deletion
     OK if no `package.json` `verify` script remains required.
   - `src/index.ts` lines 129-139 (v1.6 exports). The file becomes
     v2-only re-exports OR is deleted entirely if no consumer
     imports the package directly.

   v1.6 tests (entire files / directories deleted):
   - `tests/cli/run.test.ts`, `tests/cli/run-exit-code-2.test.ts`,
     `tests/cli/run-runtime-v1-opt-in.test.ts`,
     `tests/cli/runs.test.ts` (v1.6 CLI tests).
   - `tests/manager-run-harness.test.ts`,
     `tests/paseo-opencode-adapter.test.ts`,
     `tests/prompt-collar.test.ts`,
     `tests/four-layer-loader-render.test.ts`,
     `tests/fake-adapter.test.ts`,
     `tests/orchestrator/**`,
     `tests/live-smoke-classification.test.ts`.
   - **All tests under `tests/` that import a deleted v1.6
     module** (every test exercising `src/audit/`,
     `src/bootstrap/`, `src/compliance/`, `src/evidence/`,
     `src/governance/`, `src/identity/`, `src/integration/`,
     `src/observability/`, `src/ops/`, `src/portability/`,
     `src/portable-workflow/`, `src/publish/`, `src/release/`,
     `src/review/`, `src/schedule/`, `src/security/`,
     `src/storage/`, `src/store/`, `src/versioning/`,
     `src/extensions/`, `src/catalog/` is to be deleted with its
     subject).
   - Any other v1.6-only test discovered by lane 0 inventory.

   Retained tests (UNTOUCHED):
   - `packages/pluto-v2-core/__tests__/**`.
   - `packages/pluto-v2-runtime/__tests__/**`.
   - `tests/cli/run-runtime-v2-default.test.ts`.
   - `tests/cli/run-exit-code-2-v2.test.ts`.
   - `tests/fixtures/live-smoke/86557df1-...` (data, not code).

   v1.6 authored configs (entire directories deleted):
   - `scenarios/` — all v1.6 scenarios.
   - `playbooks/` — all v1.6 playbooks.
   - `run-profiles/` — all v1.6 run-profiles (v2 reads from
     `--spec=<path>` only).
   - `agents/` — v1.6 agent configs.
   - `evals/` — v1.6 eval infrastructure.

   Root `package.json` script removals:
   - `pluto:run:v1` (v1 opt-in convenience script).
   - `pluto:package` (the v1.6 command).
   - `pluto:runs` (the v1.6 command).
   - `pluto:submit` (the v1.6 command).
   - Any `smoke:fake` / `smoke:live` script that points to deleted
     v1.6 paths (replace with v2 equivalent that points to
     `packages/pluto-v2-runtime/scripts/smoke-live.ts`).
   - Any `verify` / `verify:*` scripts that reference
     `scripts/verify.mjs` (rewrite or delete per the verify
     decision above).

3. **CLI router surgery.**

   `src/cli/run.ts`:
   - Remove `--runtime=v1` flag handling and `runV1(...)`.
   - Remove `--scenario` / `--playbook` / `--run-profile` v1.6
     name-selector parsing.
   - `pluto:run --spec <path>` becomes the ONLY supported
     invocation.
   - If user passes `--runtime=v1`, `--scenario`, `--playbook`, or
     `--run-profile`, exit 1 with stderr:
     "v1.6 runtime was archived in S7. Reference copy lives on the
     `legacy-v1.6-harness-prototype` branch. v2 takes
     `pluto:run --spec <path>` only."
   - The `--runtime=v2` flag is silently accepted (deprecated
     but not rejected) for one transition window.

   `src/cli/shared/flags.ts` and
   `src/cli/shared/run-selection.ts`:
   - Audit imports; remove all v1-only handling.

4. **Tests — concrete enumeration.**

   The inventory at lane 0 produces the exact KEEP / DELETE /
   REWRITE list. Expected outcome:

   Kept (v2-only):
   - `tests/cli/run-runtime-v2-default.test.ts` (KEEP).
   - `tests/cli/run-exit-code-2-v2.test.ts` (KEEP).
   - All `packages/pluto-v2-core/__tests__/**` (UNTOUCHED).
   - All `packages/pluto-v2-runtime/__tests__/**` (UNTOUCHED).

   Rewritten:
   - `tests/cli/run-runtime-precedence.test.ts` — strip v1
     branches; assert that `--runtime=v1` and `PLUTO_RUNTIME=v1`
     both exit 1 with the archived message. The default-v2 branch
     remains as a no-op.
   - `tests/cli/run-unsupported-scenario.test.ts` — drop the
     v1+spec mutual-exclusion case; replace with "v1.6 name
     selector exits 1 with archived message" assertions.

   New:
   - `tests/cli/run-v1-flag-archived.test.ts` — explicitly
     asserts: `pluto:run --runtime=v1`, `pluto:run --scenario X`,
     `pluto:run --playbook Y`, `pluto:run --run-profile Z`,
     `PLUTO_RUNTIME=v1 pluto:run` ALL exit 1 with the archived
     message including the legacy branch name.

   Deleted (entire files; bulk per deliverable 2 list).

   Test count target: enumerated by the inventory. Plan does NOT
   prescribe a specific number; acceptance bar requires `pnpm test`
   to be green and the inventory to record the post-S7 count.

5. **Docs — concrete sync list.**

   Update or rewrite all 9 docs identified by discovery R1:

   - `README.md` — drop `--runtime=v1` references; remove the
     `pluto:package` / `pluto:runs` / `pluto:submit` quickstart
     examples; document `legacy-v1.6-harness-prototype` branch as
     historical reference; reference `docs/design-docs/v1-archive.md`.
   - `AGENTS.md` — strip v1.6 actor / harness references; rewrite
     for v2-only.
   - `ARCHITECTURE.md` — strip v1.6 architecture diagrams; rewrite
     for v2 (kernel + projections + runtime adapter + CLI bridge).
   - `DESIGN.md` — strip v1.6 design rationale; reference v2
     design docs.
   - `RELIABILITY.md` — update for v2 reliability surface.
   - `SECURITY.md` — update for v2 security surface.
   - `docs/mvp-alpha.md` — archive note OR rewrite for v2 MVP.
   - `docs/harness.md` — archive note (v1.6 harness is the legacy
     branch) OR rewrite for v2 paseo runtime.
   - `docs/testing-and-evals.md` — strip v1.6 eval surfaces;
     reference v2 test layout.
   - `docs/qa-checklist.md` — rewrite for v2 QA.

   New:
   - `docs/design-docs/v1-archive.md` — short doc explaining the
     archive decision, the `legacy-v1.6-harness-prototype` branch,
     how to fetch v1.6 source, and what's recoverable.

   Deferred to post-merge (NOT in the slice diff):
   - Move `docs/plans/active/v2-rewrite.md` →
     `docs/plans/completed/v2-rewrite.md`. Local manager handles
     this AFTER S7 merges, in a separate plan-status commit.

6. **Pure invariants.**

   - No v2 package code modified.
   - `pnpm typecheck` (root + both packages) clean.
   - `pnpm test` green (count enumerated by lane 0 inventory).
   - `pnpm build` clean.
   - `legacy-v1.6-harness-prototype` branch on origin remains
     intact (sanity-checked pre-deletion AND post-merge).

7. **S7 dependency graph.**

   S7 only consumes the v2 stack (read-only) plus the v1.6 surface
   that it deletes. NO mutations to `packages/`.

### Out of scope for S7

- Adding new v2 features (v2 stays at S6 baseline).
- Modifying v2 packages.
- Touching the parity fixture under
  `tests/fixtures/live-smoke/86557df1-...`.
- Pushing or modifying the `legacy-v1.6-harness-prototype` branch.

### S7 acceptance bar

- **Pre-flight branch sanity check**: `git ls-remote origin
  refs/heads/legacy-v1.6-harness-prototype` resolves to a SHA
  BEFORE any deletion happens. Recorded in the bundle artifacts.
- **Lane 0 inventory artifact** exists at
  `tasks/remote/pluto-v2-s7-archive-legacy-20260508/artifacts/v1.6-inventory.md`
  and lists every src/tests/scripts/docker/scenarios/playbooks/
  run-profiles/agents/evals file with KEEP / DELETE / REWRITE
  label.
- **Typecheck**: root + both v2 packages clean.
- **Tests**: `pnpm test` green; total count matches the inventory.
- **Build**: `pnpm --filter @pluto/v2-core build` and
  `pnpm --filter @pluto/v2-runtime build` clean.
- **No v2-package mutation**: `git diff --stat
  main..origin/<branch> -- packages/` reports zero changes.
- **`pluto:run --spec <path>` still works end-to-end** against
  `packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/scenario.yaml`
  with a mock paseo client.
- **`--runtime=v1` exits 1** with the documented archived message
  (asserted by `run-v1-flag-archived.test.ts`).
- **All 9 doc files updated** per deliverable 5 list.
- **`legacy-v1.6-harness-prototype` branch remains intact on
  origin** post-merge sanity check.
- **Diff hygiene**: deletions confined to deliverable 2 list +
  v1.6 test list + v1.6 authored configs; additions confined to
  - `src/cli/run.ts` (surgery).
  - `src/cli/shared/flags.ts` / `run-selection.ts` (surgery).
  - `tests/cli/run-runtime-precedence.test.ts` (rewrite).
  - `tests/cli/run-unsupported-scenario.test.ts` (rewrite).
  - `tests/cli/run-v1-flag-archived.test.ts` (new).
  - `package.json` (script removals).
  - 9 doc updates per deliverable 5.
  - `docs/design-docs/v1-archive.md` (new).
  - `docs/plans/active/v2-rewrite.md` — S7 status row (post-merge,
    by local manager; the plan-file move is a SEPARATE post-merge
    step, not part of this slice).
  - `tasks/remote/pluto-v2-s7-archive-legacy-20260508/**` (bundle).
- **Branch is committed AND pushed**: `commit_and_push` step.
- A reviewer sub-agent confirms: (a) every file in the inventory's
  DELETE list is removed on the slice branch, (b) every file in
  the KEEP list still exists, (c) every REWRITE file's diff is
  bounded to the documented surgery, (d) the v2 packages are
  untouched, (e) `legacy-v1.6-harness-prototype` remains on origin.

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
| S2 | Done | `main` @ `41f82e9` | `packages/pluto-v2-core/src/core/` (SpecCompiler / RunState / RunStateReducer / RunEventLog + InMemoryEventLogStore / ProtocolValidator / Authority + closed matrix + transition graph + composeRequestKey / RunKernel + injected providers / 7 test files / 121 S2 tests). Local OpenCode @oracle acceptance review READY_TO_MERGE 9/9 PASS 2026-05-07 |
| S3 | Done | `main` @ `44594f8` | `packages/pluto-v2-core/src/projections/` (Task / Mailbox / Evidence executable reducers + replayAll/replayFromStore + 5 test files / 27 S3 tests; total package 19 files / 180 tests). basic-run fixture parity asserted both deep-equal AND stable-byte-equal. FinalReportProjectionView DEFERRED. Local OpenCode @oracle acceptance polish round 8/10→10/10 PASS 2026-05-07 |
| S4 | Done | `main` @ `f9d0df4` | `packages/pluto-v2-runtime/` (new workspace: loader + runner + fake adapter + evidence packet + legacy translator + 8 test files / 45 S4 tests including parity gate against `tests/fixtures/live-smoke/86557df1-...`). Two additive S2 mutations: `team-context.ts` (FakeScriptStepSchema + optional fakeScript) and `run-kernel.ts` (seedRunStarted system-event seed API). Total v2 tests 231 (v2-core 186 + v2-runtime 45); root regression 737. 3 grep gates clean (no-runtime-leak / no-I/O-outside-loader / no-ambient-randomness). Local OpenCode acceptance R1 NEEDS_FIX → R2 READY_TO_MERGE 2026-05-07. Discovery R1→R2→R3 flow documented additive `seedRunStarted` API; manager actor used for complete_run; legacy translator covers all 20 fixture event types and legacy mailbox-kind sub-table |
| S5 | Done | `main` @ `c1a3872` | `packages/pluto-v2-runtime/src/adapters/paseo/` (PaseoCliClient via `child_process.spawn` over paseo CLI; PaseoRuntimeAdapter sub-interface + state machine; PaseoDirectiveSchema with 5 closed v2 intent variants + extractDirective; runPaseo async driver — 4 source files + 4 test files / 20 paseo tests, total v2-runtime 12 files / 65 tests). Live-smoke fixture captured at `tests/fixtures/live-smoke/029db445-aa2b-406e-ad16-fde7fb45e51d/` (6 turns, status=succeeded, run_completed reached, zero parse failures, $0 cost reported, all artifacts present). Default model `openai/gpt-5.4-mini`. Discovery R1→R2 (HTTP→CLI rewrite per option A); R8 bypassed for infrastructure debug per operator. Acceptance R1 NEEDS_FIX → R2 NEEDS_FIX → R3 READY_TO_MERGE 2026-05-07. Surface lessons: `PaseoAgentSpec.initialPrompt` (paseo CLI requires positional `<prompt>`); labels typed as `${string}=${string}` template literal; first-turn embeds in spawnAgent (no immediate sendPrompt); subsequent turns route via sendPrompt. Zero S2/S3/S4 surface mutations |
| S6 | Done | `main` @ `bb85638` | `src/cli/v2-cli-bridge.ts` (V2BridgeInput/Result/Deps with `typeof` refs to v2-runtime exports + paseoAgentSpec env-default synthesis) + `src/cli/v2-cli-bridge-error.ts` (`classifyPaseoError` covers raw `spawn ENOENT` + post-spawn missing-binary + `EACCES`) + `src/cli/run.ts` (additive `--runtime`/`--spec` routing, centralized `validateRuntimeFlags` rejecting both v2+name-selectors and v1+spec) + `src/cli/shared/flags.ts` (additive `--flag=value` inline support). 5 new test files / 9 new tests under `tests/cli/`; existing `run.test.ts` + `run-exit-code-2.test.ts` updated additively to pass `--runtime=v1`. Default runtime flipped to v2; v1.6 remains as `--runtime=v1` opt-in (deprecated; archived in S7). README updated, `docs/design-docs/v2-cli-default-switch.md` documents JSON-shape break + transition. Total root tests 234 files / 746 tests (737 baseline + 9 S6). Discovery R1 STOP_AND_ASK → R2 NEEDS_REVISION (single fix) → R3 READY_FOR_DISPATCH; remote BLOCKED on push auth → local apply + 1 cosmetic fix-up; acceptance R1 NEEDS_FIX (3 objections) → R2 READY_TO_MERGE 2026-05-08. tsconfig.json gained additive `@pluto/v2-*` path aliases (justified type-resolution-only deviation). Zero S1–S5 surface mutations |
| S7 | Done | `main` @ `a5a7a11` | Final v2 rewrite slice: archived all v1.6 mainline runtime + broader product surface. 27 src/ subdirs collapsed to 4 retained CLI files (`src/cli/{run,v2-cli-bridge,v2-cli-bridge-error}.ts` + `src/cli/shared/flags.ts`); `src/index.ts` + `src/cli/shared/run-selection.ts` deleted entirely. Total slice diff: 483 files / +444 / -88,433 LOC + 6 orphan helpers (-846 LOC) + 4-file acceptance fix-up + bundle commit. Root tests 234→7 files / 32 tests; total `pnpm test` 283 (core 186 + runtime 65 + root 32). New `tests/cli/run-v1-flag-archived.test.ts` covers all 5 archived paths; rewritten `run-runtime-precedence.test.ts` + `run-unsupported-scenario.test.ts`. 9 docs swept (README + AGENTS + ARCHITECTURE + DESIGN + RELIABILITY + SECURITY + mvp-alpha + harness + testing-and-evals + qa-checklist) + new `docs/design-docs/v1-archive.md` + `v2-cli-default-switch.md` re-headed historical. Discovery R1 STOP_AND_ASK → R2 READY_FOR_DISPATCH (8 fixes) → R3 scope expansion (lane 0 surfaced 73+ non-delete files chained on `src/contracts/`; aggressive replacement applied). Remote BLOCKED on push auth → local patch apply + orphan-helper fix-up (`tests/{fixtures,helpers,integration}` cascading deletions agent missed) → push from local. Acceptance R1 NEEDS_FIX (4 objections: bundle commit + stale `--runtime=v1` in `v2-cli-bridge.ts:199` + stale assertion in `run-unsupported-scenario.test.ts` + stale doc `v2-cli-default-switch.md`) → R2 READY_TO_MERGE 2026-05-08. Legacy branch SHA `feb5d59d2ac7d3d790c4d3e04962958416a12ffa` (`legacy-v1.6-harness-prototype`) stable pre/post merge. Zero v2-package mutation; zero parity-fixture mutation. main is now fully v2-shaped |

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

2026-05-08 — S7 merged at `main` @ `a5a7a11`; v2 rewrite complete.
Plan-file move active → completed in a separate post-merge commit.
