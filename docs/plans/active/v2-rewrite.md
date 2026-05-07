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
| S1 | Phase 1 | remote | v2 contract docs + zod schemas + replay-grade event types under `packages/pluto-v2-core/contracts/` |
| S2 | Phase 2 | remote | Pure core (SpecCompiler, RunKernel, RunEventLog, RunState reducer, ProtocolValidator, authority checks) + unit tests |
| S3 | Phase 3 | remote | Projections (task / mailbox / evidence / final report) + replay tests over fixture event streams |
| S4 | Phase 4 | remote | Fake runtime end-to-end through v2 path + parity check vs. legacy fixtures |
| S5 | Phase 5 | remote | `PaseoRuntimeAdapter` + `PaseoCliClient` thin wrapper + one bounded Paseo live smoke |
| S6 | Phase 6 | remote | `pluto:run` default switched to v2; legacy v1 opt-in for one transition window |
| S7 | Phase 7 | remote | Archive/remove v1.6 mainline runtime; keep only reference fixtures/docs |

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

### Outcome

Replay-grade contract layer published as a self-contained package, no runtime dependencies,
no execution code. Subsequent slices import from it.

### Concrete deliverables

1. New package `packages/pluto-v2-core/` with subdir `contracts/`. Package is type-only +
   zod runtime schemas. Public entry `packages/pluto-v2-core/src/index.ts` re-exports the
   contract surface.

2. `RunEvent` schema with replay-grade fields:
   - `eventId`
   - `runId`
   - `sequence`
   - `timestamp`
   - `schemaVersion`
   - `actor` (role + identity)
   - `requestId`
   - `causationId`
   - `correlationId`
   - `entityRef` (task / mailbox-message / artifact / approval / etc.)
   - accepted/rejected discriminator with rejection reason taxonomy

3. `ProtocolRequest` schema. Inputs from agents (or runtime adapters) are framed as
   protocol requests; the kernel validates authority + intent and emits accepted or
   rejected events.

4. `AuthorityValidationOutcome` enum with explicit accepted vs rejected variants and
   stable rejection reason taxonomy (e.g. `actor_not_authorized`, `entity_unknown`,
   `state_conflict`, `schema_invalid`, `idempotency_replay`).

5. Projection contracts:
   - `TaskProjectionView`
   - `MailboxProjectionView`
   - `EvidenceProjectionView`
   - `FinalReportProjectionView` (where applicable)
   - Each declares projection inputs (`RunEvent` kinds) and idempotent reduce semantics.

6. Replay acceptance rules (doc + test fixture format under
   `packages/pluto-v2-core/test-fixtures/replay/`): given a `RunEvent[]`, projecting
   twice yields identical views (idempotency); replay from fixtures matches recorded
   `EvidencePacketView`.

7. Versioning: `schemaVersion` must be present on every event. Plan describes how
   contract evolution is allowed (additive fields only within a major version; breaking
   changes bump major + provide migrators).

8. ESM-only TypeScript, strict, zero runtime deps beyond `zod`. Tsconfig wired into the
   workspace root.

9. Tests:
   - `vitest` unit tests that round-trip parse known-good event examples and reject
     known-bad examples (one per rejection reason).
   - Replay tests over a hand-written fixture event stream produce expected projection
     snapshots.

10. Docs:
    - `packages/pluto-v2-core/README.md` summarizing the public surface.
    - `docs/design-docs/v2-contracts.md` describing the model with diagrams (text-only OK).

### Out of scope for S1

- No runtime, no adapter, no CLI work.
- No `manager-run-harness.ts` edits.
- No backwards-compatibility shims to v1.6 file lineage; legacy stays on its branch.

### S1 dependency graph

S1 has no upstream blockers. Downstream: S2 imports the contracts package.

### S1 acceptance bar

- `pnpm typecheck` clean across workspace including the new package.
- `pnpm test` green; new tests run in the same suite.
- `pnpm exec vitest run packages/pluto-v2-core` green and finishes under 60 s.
- A reviewer sub-agent confirms the contract surface matches the handoff's RunEvent
  field list and rejection taxonomy.
- No edits outside `packages/pluto-v2-core/`, `docs/design-docs/v2-contracts.md`, the
  workspace `tsconfig` / `package.json` / `pnpm-workspace.yaml`, and the
  `docs/plans/active/v2-rewrite.md` plan status section.

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
