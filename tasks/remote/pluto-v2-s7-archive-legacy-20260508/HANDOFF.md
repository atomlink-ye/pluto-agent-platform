# HANDOFF — Pluto v2 S7 (Archive legacy mainline runtime — final slice)

Task ID: `pluto-v2-s7-archive-legacy-20260508`
Iteration: Pluto v2 rewrite, Phase 7 (FINAL).
Authority plan: `docs/plans/active/v2-rewrite.md` — section
**"S7 — Phase 7: Archive legacy mainline runtime code (final
slice)"** (canonical, at HEAD on `main` `3a931fd`).
Prior slices on `main`: S1 `c9bc46f`, S2 `41f82e9`, S3 `44594f8`,
S4 `f9d0df4`, S5 `c1a3872`, S6 `bb85638` (status row `d6cab47`).

## Goal

Aggressive deletion of v1.6 mainline runtime from `main`. After
S7 ships, `main` is fully v2-shaped. v1.6 stays ONLY on the
reference branch `legacy-v1.6-harness-prototype` (already on
origin; DO NOT mutate or delete).

`pnpm pluto:run --spec <path>` becomes the ONLY supported
invocation. `--runtime=v1`, `--scenario`, `--playbook`,
`--run-profile`, and `PLUTO_RUNTIME=v1` ALL exit 1 with the
documented archived-message stderr referencing the legacy branch.

**Operator decision (binding):** option A (full v2 replacement),
permanently confirmed for all v2-vs-v1.6 keep/replace decisions —
delete v1.6 source, tests, CLI commands, configs, docs; v1.6
recovery is git-cheap from the legacy branch.

## Authority hierarchy

1. `docs/plans/active/v2-rewrite.md` — S7 section canonical.
2. `acceptance.md` — restated bar + 9 gates (this bundle).
3. `prompt.md` — working prompt for the remote root manager.
4. `commands.sh` — gates + `commit_and_push`.

## Non-goals (hard FAIL if shipped)

- ANY mutation under `packages/pluto-v2-core/**` or
  `packages/pluto-v2-runtime/**` (S1–S6 surface is read-only).
- Touching the parity fixture
  `tests/fixtures/live-smoke/86557df1-...`.
- Pushing to or modifying `legacy-v1.6-harness-prototype` on
  origin.
- Adding new v2 features (v2 stays at S6 baseline).
- Live-smoke as a CLI gate (S5 captured the binding fixture; S7
  is delete-only).
- Moving `docs/plans/active/v2-rewrite.md` →
  `docs/plans/completed/v2-rewrite.md` IN this slice — that is a
  SEPARATE post-merge step performed by the local manager.

## Boundaries (allowed edits)

### Deletions (entire files / directories)

**R3 scope (2026-05-08):** Lane 0 inventory found the v1.6 surface
under `src/` is 27 subdirs / 211 TS files; only
`src/cli/{run,v2-cli-bridge}.ts` import v2 packages. Per binding
aggressive-replacement rule, the deletion list spans EVERY src/
subdir NOT in the retained-entrypoint set.

Source code (entire trees deleted):

v1.6 runtime trees:
- `src/adapters/` (paseo-opencode + fake; v2 equivalents under
  `packages/pluto-v2-runtime/src/adapters/`).
- `src/four-layer/`.
- `src/orchestrator/`.
- `src/contracts/`.
- `src/runtime/`.

v1.6 broader product surface (cascading from `src/contracts/`
deletion):
- `src/audit/`, `src/bootstrap/`, `src/catalog/`,
  `src/compliance/`, `src/evidence/`, `src/extensions/`,
  `src/governance/`, `src/identity/`, `src/integration/`,
  `src/observability/`, `src/ops/`, `src/portability/`,
  `src/portable-workflow/`, `src/publish/`, `src/release/`,
  `src/review/`, `src/schedule/`, `src/security/`,
  `src/storage/`, `src/store/`, `src/versioning/`.
- Any other `src/<subdir>/` discovered by lane 0 NOT in the
  retained-entrypoint set.

v1.6 auxiliary CLI commands:
- `src/cli/package.ts`.
- `src/cli/runs.ts`.
- `src/cli/submit.ts`.
- Any other `src/cli/*.ts` not in retained-entrypoint list.

v1.6 build / verify / smoke infra:
- `docker/live-smoke.ts`.
- `scripts/verify.mjs` (rewrite to v2-only verify OR delete
  outright; deletion preferred if no `verify` script remains).
- `src/index.ts` lines 129-139 v1 exports (file becomes v2-only
  re-exports OR deleted entirely if no consumer imports it).

v1.6 tests:
- `tests/cli/run.test.ts`, `tests/cli/run-exit-code-2.test.ts`,
  `tests/cli/run-runtime-v1-opt-in.test.ts`,
  `tests/cli/runs.test.ts`.
- `tests/manager-run-harness.test.ts`,
  `tests/paseo-opencode-adapter.test.ts`,
  `tests/prompt-collar.test.ts`,
  `tests/four-layer-loader-render.test.ts`,
  `tests/fake-adapter.test.ts`,
  `tests/orchestrator/**`,
  `tests/live-smoke-classification.test.ts`.
- **All tests under `tests/` that import a deleted v1.6 module**
  (every test exercising `src/audit/`, `src/bootstrap/`,
  `src/compliance/`, `src/evidence/`, `src/governance/`,
  `src/identity/`, `src/integration/`, `src/observability/`,
  `src/ops/`, `src/portability/`, `src/portable-workflow/`,
  `src/publish/`, `src/release/`, `src/review/`, `src/schedule/`,
  `src/security/`, `src/storage/`, `src/store/`,
  `src/versioning/`, `src/extensions/`, `src/catalog/` is
  deleted with its subject).
- Any other v1.6-only test discovered by lane 0 inventory.

v1.6 authored configs (entire directories):
- `scenarios/`.
- `playbooks/`.
- `run-profiles/`.
- `agents/`.
- `evals/`.

Root `package.json` script removals:
- `pluto:run:v1`.
- `pluto:package`.
- `pluto:runs`.
- `pluto:submit`.
- `smoke:fake` / `smoke:live` if pointing at deleted v1.6 paths
  (replace with v2 equivalent at
  `packages/pluto-v2-runtime/scripts/smoke-live.ts` if a v2 smoke
  script is desired; otherwise delete).
- Any `verify` / `verify:*` scripts referencing
  `scripts/verify.mjs`.

### Surgery (additive / rewrite, bounded)

- `src/cli/run.ts` — remove `--runtime=v1` handling and
  `runV1(...)`; remove `--scenario` / `--playbook` /
  `--run-profile` parsing; `--spec <path>` becomes the only
  invocation; `--runtime=v2` silently accepted (deprecated) for
  one transition window. Any v1 selector → exit 1 with stderr:
  "v1.6 runtime was archived in S7. Reference copy lives on the
  `legacy-v1.6-harness-prototype` branch. v2 takes
  `pluto:run --spec <path>` only."
- `src/cli/shared/flags.ts` — drop v1-only handling.
- `src/cli/shared/run-selection.ts` — drop v1-only handling
  (likely deletion-only since v2 only takes `--spec`).
- `tests/cli/run-runtime-precedence.test.ts` — REWRITE: strip v1
  branches; assert `--runtime=v1` and `PLUTO_RUNTIME=v1` both
  exit 1 with archived message.
- `tests/cli/run-unsupported-scenario.test.ts` — REWRITE: drop
  v1+spec mutual-exclusion case; replace with archived-message
  assertions for v1.6 name selectors.

### New

- `tests/cli/run-v1-flag-archived.test.ts` — explicit assertions
  for `--runtime=v1`, `--scenario X`, `--playbook Y`,
  `--run-profile Z`, `PLUTO_RUNTIME=v1`. Each MUST exit 1 with
  archived message including `legacy-v1.6-harness-prototype`.
- `docs/design-docs/v1-archive.md` — short doc explaining the
  archive decision, the legacy branch, fetch instructions, and
  what is recoverable.

### Doc sync (9 files; update / rewrite per plan deliverable 5)

- `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, `DESIGN.md`,
  `RELIABILITY.md`, `SECURITY.md`, `docs/mvp-alpha.md`,
  `docs/harness.md`, `docs/testing-and-evals.md`,
  `docs/qa-checklist.md`.

### Read-only (DO NOT touch)

- `packages/pluto-v2-core/**`.
- `packages/pluto-v2-runtime/**`.
- `tests/fixtures/live-smoke/86557df1-...`.
- `legacy-v1.6-harness-prototype` branch on origin (sanity-check
  only; never push).
- `src/cli/v2-cli-bridge.ts` / `v2-cli-bridge-error.ts` (S6
  output; UNTOUCHED unless the v1-removal surgery requires
  bounded mechanical edits).

## Sandbox constraint

Same warm sandbox as S1–S6:

- Sandbox ID: `c8ef5890-f1d2-4f53-a76d-b6ec6ae38549`
- Snapshot: `personal-dev-env-vps-5c10g150g`
- Workspace: `/workspace`

`commit_and_push` BINDING from S2 carries forward. NO live-smoke
in S7.

## Pre-flight branch sanity

BEFORE any deletion, the implementation MUST:

1. Run `git ls-remote origin refs/heads/legacy-v1.6-harness-prototype`
   from inside the worktree.
2. Capture the resolved SHA to
   `tasks/remote/pluto-v2-s7-archive-legacy-20260508/artifacts/legacy-branch-sha-pre.txt`.

Re-check post-merge with the SAME command and capture to
`legacy-branch-sha-post.txt`. SHAs MUST match.

## Lane 0 inventory (binding artifact)

`tasks/remote/pluto-v2-s7-archive-legacy-20260508/artifacts/v1.6-inventory.md`
MUST exist BEFORE any deletion is committed and MUST list every
file under `src/`, `tests/`, `scripts/`, `docker/`, `scenarios/`,
`playbooks/`, `run-profiles/`, `agents/`, `evals/` with one of:
KEEP / DELETE / REWRITE. Mechanism: `tsc --listFiles -p
tsconfig.json` filtered + cross-checked against `package.json`
script references and Vitest include patterns.

The retained-entrypoint set used to derive the import graph:

- `src/cli/run.ts` (post-surgery, v2-only).
- `src/cli/v2-cli-bridge.ts` / `v2-cli-bridge-error.ts`.
- `src/cli/shared/flags.ts` / `run-selection.ts`.
- `packages/pluto-v2-core/**`.
- `packages/pluto-v2-runtime/**`.
- `tests/fixtures/live-smoke/86557df1-...` (data, not code).
- `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`,
  `pnpm-workspace.yaml`, root `package.json` (post-script
  cleanup).
- v2-only retained tests: `tests/cli/run-runtime-v2-default.test.ts`,
  `tests/cli/run-exit-code-2-v2.test.ts`,
  `tests/cli/run-runtime-precedence.test.ts` (REWRITE),
  `tests/cli/run-unsupported-scenario.test.ts` (REWRITE),
  `tests/cli/run-v1-flag-archived.test.ts` (NEW).

## Final response schema

Write final report at
`tasks/remote/pluto-v2-s7-archive-legacy-20260508/artifacts/REPORT.md`
matching the structure of S2/S3/S4/S5/S6 reports:

- Sandbox / commit+push state.
- Pre-flight & post-merge legacy-branch SHA.
- Lane 0 inventory pointer (artifact path + total counts: KEEP /
  DELETE / REWRITE).
- Scope per deliverable (1 — inventory, 2 — deletion list,
  3 — CLI surgery, 4 — tests, 5 — docs, 6 — invariants).
- Closure proofs (each acceptance bar item).
- Grep results (no v1.6 imports remain in retained code; no
  `--runtime=v1` references outside the archived test).
- Files changed (deletes vs adds vs rewrites; counts).
- Validation gate output paths (bootstrap / typecheck / test /
  build / no-packages-mutation).
- Remote review loop summary.
- Known issues / suggested local inspection.

## Last updated

2026-05-08 — Discovery R1 STOP_AND_ASK → R2 READY_FOR_DISPATCH
(all 8 R1 fixes verified against plan @ `3a931fd`).
