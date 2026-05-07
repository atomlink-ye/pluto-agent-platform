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
   - `task_created`: `{ taskId: string, title: string, ownerActor: ActorRef | null, dependsOn: string[] }`
   - `task_state_changed`: `{ taskId: string, from: TaskState, to: TaskState }` where `TaskState = 'queued' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled'`.
   - `artifact_published`: `{ artifactId: string, kind: 'final' | 'intermediate', mediaType: string, byteSize: number }`

   **Rejected** events have shape:

   - `outcome: 'rejected'`
   - `kind: 'request_rejected'`
   - `payload: { rejectionReason: RejectionReason, rejectedRequestId: string, detail: string }`

   Where `RejectionReason` is the closed taxonomy from deliverable 4.

   The S1 schema MUST be a single discriminated zod union of all the above shapes such
   that `RunEventSchema.parse(unknown)` accepts all valid examples and rejects anything
   else.

   2a. **`ActorRef` closed union**: `{ kind: 'manager' } | { kind: 'role', role: 'lead' | 'planner' | 'generator' | 'evaluator' } | { kind: 'system' }`. The `role` set is closed at v1.0 and additive within major. The contract MUST NOT model role-bound helper paths or helper CLI lineage; `ActorRef` is identity, not transport.

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

   Per-intent payload schemas mirror the corresponding accepted-event payload, minus
   server-assigned fields (`messageId`, `taskId`, etc.). The plan documents the exact
   request→event mapping in `docs/design-docs/v2-contracts.md`.

4. **`AuthorityValidationOutcome` and closed `RejectionReason` taxonomy.**

   `AuthorityValidationOutcome = { ok: true } | { ok: false, reason: RejectionReason, detail: string }`.

   Closed `RejectionReason` taxonomy at v1.0 (additive within major):

   - `actor_not_authorized` — actor does not have the role required for this intent.
   - `entity_unknown` — `entityRef` or any `*Id` in the payload references a non-existent entity for the run.
   - `state_conflict` — the request would violate run state (e.g. `task_state_changed` from a state that disallows the target).
   - `schema_invalid` — request did not parse against the zod schema.
   - `idempotency_replay` — `(runId, actor, intent, idempotencyKey)` already produced an accepted event.
   - `intent_unknown` — `intent` is not in the closed enum (defensive; should be caught by `schema_invalid` but kept distinct for clarity).

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
   - Within the same major: only **additive optional fields** and **additive enum
     members** are allowed. Existing required fields stay required and keep their
     types. New event kinds may be added to the discriminated union; old fixtures
     without those kinds remain valid.
   - Major bump (`"2.0"`): allowed to remove fields, change types, or remove enum
     members. Major bumps MUST ship a programmatic migrator from the prior major; the
     migrator is part of the package.
   - Fixture compatibility expectation: a fixture written today with `schemaVersion =
     "1.0"` MUST parse successfully against any future `"1.x"` schema. The package's
     happy-path tests include this expectation.

8. **Packaging & build.** ESM only, strict TypeScript, zero runtime deps beyond `zod`.
   The package compiles via `tsc --build` invoked through the workspace; root
   `pnpm-workspace.yaml` declares only `packages/pluto-v2-core`; root `.gitignore` adds
   an explicit allow-list exception (`!packages/pluto-v2-core/` and
   `!packages/pluto-v2-core/**`) so the new package is tracked even though `packages/`
   is otherwise ignored.

9. **Tests (S1 scope).**

   - `__tests__/run-event.test.ts`: happy-path parse + round-trip per accepted kind +
     happy-path parse for `request_rejected`.
   - `__tests__/run-event-rejection.test.ts`: one negative test per `RejectionReason`
     (six tests), each constructing an invalid event and asserting parse failure. Note
     these test schema rejection at the contract layer, not authority logic (which is
     S2).
   - `__tests__/protocol-request.test.ts`: happy-path parse per intent + one
     `schema_invalid` negative + one `intent_unknown` negative.
   - `__tests__/projection-contracts.test.ts`: type-level checks (compile-time `expect
     <T extends ...>`) confirming that `inputKinds ∪ outOfScopeKinds = AllKinds` for
     each projection. NO reducer tests in S1.
   - `__tests__/replay-fixture.test.ts`: one fixture loads, parses against
     `RunEventSchema`, and the `expectedViews` shapes parse against their respective
     view shapes. NO reducer execution.
   - `__tests__/versioning.test.ts`: a future-`"1.x"` event (with one extra optional
     field) parses successfully against the v1.0 schema; a `"2.0"` event is rejected
     unless the migrator is present.

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

- `pnpm typecheck` clean across workspace including the new package.
- `pnpm exec vitest run packages/pluto-v2-core` green and finishes under 60 s.
- `pnpm test` green (one full-suite run only, at slice end; R7).
- `RunEvent` is a single zod discriminated union over the closed kind set; every
  rejection reason has a dedicated negative test; every projection contract declares
  `inputKinds` AND `outOfScopeKinds` covering all kinds; `EntityRef` includes only the
  four listed kinds (no `approval`); `ActorRef.role` is the closed four-role set; no
  exported type or schema mentions Paseo, OpenCode, helper CLI paths, role-bound
  helper paths, adapter sessions, or active hooks runtime.
- `versioning.test.ts` proves the additive forward-compat rule.
- A reviewer sub-agent confirms (a) the contract surface matches deliverables 2..7,
  (b) no executable reducer or replay machinery is shipped in S1, and (c) no out-of-scope
  surfaces (approval / publish-package / schedule / RBAC) leak in.
- Diff hygiene: edits limited to `packages/pluto-v2-core/**`,
  `docs/design-docs/v2-contracts.md`, the `S1` row of `docs/plans/active/v2-rewrite.md`'s
  Status tracker, root `pnpm-workspace.yaml` (created if missing; declares only the new
  package), root `.gitignore` (allow-list exception for the new package only), and root
  `tsconfig.json` / `tsconfig.build.json` (only `references` additions if needed for the
  new package to compile). No edits to `src/`, `tests/`, `evals/`, `docker/`,
  `docs/plans/active/*` (other than the S1 row), `docs/exec-plans/*` (no such dir),
  `playbooks/`, `scenarios/`, `run-profiles/`, or any v1.6 contract file.

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
| S1 | Not started | TBD | TBD |
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
