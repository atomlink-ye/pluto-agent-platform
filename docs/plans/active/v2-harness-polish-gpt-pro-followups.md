# T12 — Pluto v2 Harness Polish: GPT Pro Follow-Ups

**Status**: active. Iteration started 2026-05-09. Predecessor: T11
(craft-fidelity-final-reconciliation, closed PASS 6/6 at `b33a1ff6`).

## Why

GPT Pro reviewed the post-T11 codebase and identified a set of
follow-ups grouped P0 → P4. T9–T11 hardened the actor protocol
(unified CLI, --actor, lifecycle wait, composite verbs, token
binding); T12 polishes around that core to bring the harness
closer to v1 quality:

- Docs and prompts have drifted behind the implementation (P0).
- Actor bridge still depends on `tsx` + source tree + a zod symlink
  hack — not portable (P1).
- `final-reconciliation` is a thin wrapper, not the audit gate the
  TRD requires (P2).
- No replay / audit / explain CLI for users to inspect or
  reproduce a run (P4).

## Scope (in)

- **T12-S1** *(P0, manager-local)* — README + `docs/harness.md`
  refresh, prompt-builder "auto-wait" wording fix, T9 plan
  closure note for S1b.
- **T12-S2** *(P1, sandbox)* — Compile `pluto-tool` to JS; actor
  wrapper invokes `node <dist>/cli/pluto-tool.js`, not
  `tsx --tsconfig <runtime> <pluto-tool.ts>`. Remove
  `ensureCoreSourceDependencyLinks` (zod symlink). Tests verify
  the bridge has no `tsx` / source-tree dependency at runtime.
- **T12-S3** *(P2, sandbox)* — Upgrade
  `runFinalReconciliation` to validate citations:
  - Args extended with `citedArtifactRefs`, `unresolvedIssues`.
  - Validate `completedTasks` exist + are terminal.
  - Validate `citedMessages` exist (in mailbox transcript).
  - Validate `citedArtifactRefs` exist (in artifact registry).
  - On failure → `complete_run` with `status=failed_audit` and
    structured failure reasons; otherwise `succeeded`.
  - Emit `finalReconciliation` projection (runtime-side, not
    kernel) under `evidence/`.
- **T12-S4a** *(P4, sandbox)* — `pnpm pluto:runs replay <runId>`
  and `pnpm pluto:runs explain <runId>` root scripts.
  - `replay` re-folds the event log through the closed reducer
    and diffs the materialized projection vs replayed
    projection (deterministic check).
  - `explain` reads the run's evidence (final reconciliation +
    audit result if S3 merged + traces) and prints a
    user-readable failure classification.
- **T12-S4b** *(P4, sandbox, after S3 merges)* —
  `pnpm pluto:runs audit <runId>` consumes S3's
  `finalReconciliation` projection and reports pass /
  failed_audit with citations.

## Scope (out / deferred)

- **P3 open role schema**. `ActorRole = z.string()` requires
  editing the closed kernel (`packages/pluto-v2-core/src/`),
  which the playbook forbids. Defer to a future iteration that
  explicitly thaws the kernel under operator decision.
- **build-time vs runtime CLI for spec-hygiene / smoke:live**.
  Out of scope; only the actor-facing `pluto-tool` is compiled
  in S2.

## Slice plan

### T12-S1 — Doc / prompt hygiene (manager-local)

Files:
- `README.md` — update CLI examples to `--actor` + composite verbs.
- `docs/harness.md` — drop "Paseo --env injection" framing for
  the CLI; explain run-level binary + actor token binding +
  composite tools; update CLI surface listing.
- `packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts`
  lines ~341 and ~350 — change "prefer wait" to "auto-wait
  unless --no-wait, do not poll".
- `docs/plans/completed/v2-harness-workflow-hardening.md` —
  closure note: T9-S1b implemented.

### T12-S2 — Compiled pluto-tool bridge

- Build `packages/pluto-v2-runtime/dist/cli/pluto-tool.cjs`
  (or `.js`, whichever resolves cleanly) via tsup or tsc.
- Update `actor-bridge.ts`:
  - Wrapper now does `exec node "<dist>/cli/pluto-tool.js" "$@"`.
  - Drop `ensureCoreSourceDependencyLinks`.
  - Drop `tsxBinPath` / `runtimeTsconfigPath` fields.
- Bridge dependency tests verify dist exists, source path is
  not required.
- Build hook in package.json: `prebuild` or `build` invokes
  bundler; `pluto:run` and `smoke:live` continue to use `tsx`
  for the orchestrator side (only the actor CLI is bundled).

### T12-S3 — Final-reconciliation audit gate

- Extend `FinalReconciliationArgsSchema`:
  - `citedArtifactRefs: z.array(z.string()).default([])`
  - `unresolvedIssues: z.array(z.string()).default([])`
- New `validateFinalReconciliation` helper:
  - Read PromptView (tasks + transcript + artifacts).
  - Verify each `completedTaskId` exists and is terminal.
  - Verify each `citedMessageId` exists.
  - Verify each `citedArtifactRef` exists.
  - Empty arrays → audit pass (caller chose minimum).
- On audit fail: `complete_run` with `status=failed_audit`
  (using existing `failed` if `failed_audit` not in kernel
  enum — compatible runtime mapping).
- Emit `finalReconciliation` evidence file:
  - `<runDir>/evidence/final-reconciliation.json`
  - Includes summary, citations, audit result, failures.
- Test: `composite-tools.test.ts` covers happy / missing-task /
  missing-message / missing-artifact / non-terminal-task.

### T12-S4a — Replay + Explain CLI

- `packages/pluto-v2-runtime/src/cli/runs.ts`:
  - `replay <runId>`: load events.jsonl, run reducer, compare
    against `<runDir>/state/projection.json` (or whatever the
    materialized name is). Print PASS / DRIFT with diff.
  - `explain <runId>`: print a readable narrative — task
    closeouts, mailbox by role, evidence list, final
    reconciliation summary, audit result if present.
- Root script: `pluto:runs` → `tsx packages/pluto-v2-runtime/src/cli/runs.ts`.
- Implementation note (2026-05-09): current runtime bundles expose
  `projections/tasks.json`, `projections/mailbox.jsonl`, and
  `projections/artifacts.json` as the canonical on-disk views;
  `replay` checks `tasks.json`, while `explain` reads those views plus
  optional `evidence/final-reconciliation.json`.

### T12-S4b — Audit CLI

- After S3 merges, add `audit <runId>` subcommand to
  `runs.ts`. Reads `evidence/final-reconciliation.json`,
  prints PASS / FAILED_AUDIT with structured failures.

## Wave plan

- **Wave 0** (manager-local): S1.
- **Wave 1** (parallel sandbox dispatch): S2 + S3 + S4a in
  three separate worktrees. They touch disjoint files (bridge
  / composite-tools / new runs.ts).
- **Wave 2** (after S3 merges): S4b on top of S3 audit
  projection.
- **POST-T12**: re-run Symphony scenario with the audit gate;
  verify 6/6 still PASS, plus audit result emitted.

## Acceptance (for the iteration)

1. README + harness docs reflect actual CLI shape.
2. Bridge wrapper does not reference `tsx` or source files at
   runtime.
3. `pnpm typecheck` (split src/test) passes for all touched
   packages.
4. New tests for S2/S3/S4 pass.
5. Symphony scenario still 6/6 with audit gate active.
6. `pluto:runs explain <runId>` produces a readable report on
   the POST-T12 run.

## Stop conditions

1. Bundler choice spirals (tsup / esbuild / tsc references) →
   pick the simplest that produces a single self-contained JS,
   document in REPORT.
2. S3 audit gate flags too many fixtures false-positive →
   relax to "warn-only" first, hard-fail in T13.
3. Replay drift detected in canonical fixtures → that's a real
   bug, escalate.

## Predecessor state

- main HEAD `b33a1ff6`.
- T9–T11 closed PASS 6/6 on Symphony.
- All T9/T10/T11 plans archived to `docs/plans/completed/`.
- `docs/notes/t9-context-packet.md` is the predecessor map;
  `docs/notes/t12-context-packet.md` extends it.
