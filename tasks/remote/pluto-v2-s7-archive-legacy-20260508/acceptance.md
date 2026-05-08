# Acceptance bar — pluto-v2-s7-archive-legacy-20260508

This file restates the binding acceptance items from canonical
plan section "S7 — Phase 7: Archive legacy mainline runtime code
(final slice)" of `docs/plans/active/v2-rewrite.md` (HEAD on
`main` `3a931fd`). On conflict, the plan wins. Local manager will
re-verify each item before merge.

## Binding tables / specs (verbatim from plan)

### A. Reference branch (binding)

Archive branch on origin: **`legacy-v1.6-harness-prototype`**
(NOT `legacy/v1.6-runtime` — that earlier plan name was a typo
caught in discovery R1).

Pre-flight: `git ls-remote origin
refs/heads/legacy-v1.6-harness-prototype` MUST return a SHA before
any deletion. Recorded in `artifacts/legacy-branch-sha-pre.txt`.

Post-merge: same command MUST still return the same SHA;
recorded in `artifacts/legacy-branch-sha-post.txt`.

### B. Lane 0 inventory artifact (deliverable 1)

`artifacts/v1.6-inventory.md` MUST:

- Be produced BEFORE any deletion commit lands.
- Cover every file under `src/`, `tests/`, `scripts/`, `docker/`,
  `scenarios/`, `playbooks/`, `run-profiles/`, `agents/`,
  `evals/`.
- Label every file as KEEP / DELETE / REWRITE.
- Be derived from `tsc --listFiles -p tsconfig.json` filtered +
  cross-checked against `package.json` script references and
  Vitest include patterns.
- Use the retained-entrypoint set from the plan deliverable 1.

### C. Removed v1.6 surface (deliverable 2 — binding list)

**R3 scope expansion (2026-05-08):** lane 0 found 27 subdirs /
211 TS files under `src/`; only `src/cli/{run,v2-cli-bridge}.ts`
import v2 packages. Deletion list expands to every src/ subdir
NOT in the retained-entrypoint set.

Source code (entire trees):

v1.6 runtime trees:
- `src/adapters/` (paseo-opencode + fake).
- `src/four-layer/`.
- `src/orchestrator/`.
- `src/contracts/`.
- `src/runtime/`.

v1.6 broader product surface (cascading; all chain off v1.6
contracts):
- `src/audit/`, `src/bootstrap/`, `src/catalog/`,
  `src/compliance/`, `src/evidence/`, `src/extensions/`,
  `src/governance/`, `src/identity/`, `src/integration/`,
  `src/observability/`, `src/ops/`, `src/portability/`,
  `src/portable-workflow/`, `src/publish/`, `src/release/`,
  `src/review/`, `src/schedule/`, `src/security/`,
  `src/storage/`, `src/store/`, `src/versioning/`.
- Any other `src/<subdir>/` discovered by lane 0 NOT in the
  retained-entrypoint set.

v1.6 auxiliary CLI commands (entire files):

- `src/cli/package.ts`.
- `src/cli/runs.ts`.
- `src/cli/submit.ts`.
- Any other `src/cli/*.ts` not in the retained-entrypoint list.

v1.6 build / verify / smoke infrastructure:

- `docker/live-smoke.ts`.
- `scripts/verify.mjs` — rewrite to v2-only verify OR delete
  outright.
- `src/index.ts` lines 129-139 v1 exports — v2-only re-exports
  OR full deletion.

v1.6 tests (entire files / dirs):

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
  (every test exercising the broader product surface listed
  above is deleted with its subject).
- Any other v1.6-only tests discovered by lane 0 inventory.

v1.6 authored configs (entire directories):

- `scenarios/`, `playbooks/`, `run-profiles/`, `agents/`,
  `evals/`.

Root `package.json` script removals:

- `pluto:run:v1`, `pluto:package`, `pluto:runs`, `pluto:submit`.
- `smoke:fake` / `smoke:live` if pointing at deleted v1.6 paths.
- `verify` / `verify:*` referencing `scripts/verify.mjs`.

### D. CLI router surgery (deliverable 3)

`src/cli/run.ts`:

- Remove `--runtime=v1` flag handling and `runV1(...)`.
- Remove `--scenario` / `--playbook` / `--run-profile` parsing.
- `pluto:run --spec <path>` becomes the ONLY supported
  invocation.
- `--runtime=v2` silently accepted (deprecated; one transition
  window).
- `--runtime=v1`, `--scenario`, `--playbook`, `--run-profile`,
  `PLUTO_RUNTIME=v1` ALL exit 1 with stderr (verbatim, single
  line):

  ```
  v1.6 runtime was archived in S7. Reference copy lives on the legacy-v1.6-harness-prototype branch. v2 takes pluto:run --spec <path> only.
  ```

`src/cli/shared/flags.ts` and `run-selection.ts`:

- Audit imports; remove all v1-only handling.

### E. Tests (deliverable 4 — concrete list)

KEEP (v2-only; UNTOUCHED):

- `tests/cli/run-runtime-v2-default.test.ts`.
- `tests/cli/run-exit-code-2-v2.test.ts`.
- All `packages/pluto-v2-core/__tests__/**`.
- All `packages/pluto-v2-runtime/__tests__/**`.

REWRITE:

- `tests/cli/run-runtime-precedence.test.ts` — strip v1 branches;
  assert `--runtime=v1` and `PLUTO_RUNTIME=v1` both exit 1 with
  archived message; default-v2 branch remains as a no-op.
- `tests/cli/run-unsupported-scenario.test.ts` — drop v1+spec
  mutual-exclusion case; replace with archived-message
  assertions for v1.6 name selectors.

NEW:

- `tests/cli/run-v1-flag-archived.test.ts` — explicit assertions
  for: `pluto:run --runtime=v1`, `pluto:run --scenario X`,
  `pluto:run --playbook Y`, `pluto:run --run-profile Z`,
  `PLUTO_RUNTIME=v1 pluto:run`. ALL exit 1 with archived message
  containing the literal `legacy-v1.6-harness-prototype`.

DELETE: full list under section C.

Test count target: enumerated by lane 0 inventory; plan does NOT
prescribe a number. Acceptance requires `pnpm test` GREEN and the
inventory to record the post-S7 count.

### F. Docs (deliverable 5 — concrete sync list)

Update or rewrite all 9 docs identified by discovery R1:

- `README.md` — drop `--runtime=v1` references; remove
  `pluto:package` / `pluto:runs` / `pluto:submit` quickstart;
  document `legacy-v1.6-harness-prototype` as historical
  reference; link `docs/design-docs/v1-archive.md`.
- `AGENTS.md` — strip v1.6 actor / harness refs; rewrite for
  v2-only.
- `ARCHITECTURE.md` — strip v1.6 architecture; rewrite for v2
  (kernel + projections + runtime adapter + CLI bridge).
- `DESIGN.md` — strip v1.6 design rationale; reference v2 design
  docs.
- `RELIABILITY.md` — update for v2 reliability surface.
- `SECURITY.md` — update for v2 security surface.
- `docs/mvp-alpha.md` — archive note OR rewrite for v2 MVP.
- `docs/harness.md` — archive note (legacy harness lives on
  legacy branch) OR rewrite for v2 paseo runtime.
- `docs/testing-and-evals.md` — strip v1.6 eval surfaces;
  reference v2 test layout.
- `docs/qa-checklist.md` — rewrite for v2 QA.

NEW: `docs/design-docs/v1-archive.md` — short doc: archive
decision, legacy branch, fetch instructions, what is recoverable.

DEFERRED to post-merge (NOT in slice diff):

- Move `docs/plans/active/v2-rewrite.md` →
  `docs/plans/completed/v2-rewrite.md` (local manager handles
  this AFTER S7 merges, in a separate plan-status commit).

## Gates

### Gate 0 — Pre-flight legacy-branch sanity

```bash
git ls-remote origin refs/heads/legacy-v1.6-harness-prototype \
  > tasks/remote/pluto-v2-s7-archive-legacy-20260508/artifacts/legacy-branch-sha-pre.txt
```

MUST be non-empty AND match a SHA. Recorded BEFORE any deletion.

### Gate 1 — Lane 0 inventory exists

`artifacts/v1.6-inventory.md` exists, lists every relevant file
with KEEP / DELETE / REWRITE label, and was committed BEFORE any
deletion lands (or in the same commit as deletion, but produced
first via `tsc --listFiles`-driven mechanism).

### Gate 2 — Typecheck (root + both packages)

```bash
pnpm --filter @pluto/v2-core typecheck
pnpm --filter @pluto/v2-runtime typecheck
pnpm exec tsc -p tsconfig.json --noEmit
```

All clean.

### Gate 3 — Tests

```bash
pnpm --filter @pluto/v2-core test    # ≥ 186 (S5/S6 baseline; UNTOUCHED)
pnpm --filter @pluto/v2-runtime test # ≥ 65 (S5/S6 baseline; UNTOUCHED)
pnpm test                              # post-S7: count ≤ S6 baseline
                                       # (746 → fewer after v1 deletes;
                                       # exact target enumerated by inventory)
```

All green. The new test `run-v1-flag-archived.test.ts` MUST cover
all 5 archived-message paths.

### Gate 4 — Build

```bash
pnpm --filter @pluto/v2-core build
pnpm --filter @pluto/v2-runtime build
```

Both clean.

### Gate 5 — No v2-package mutation

```bash
git diff --stat main..HEAD -- packages/
```

Expected: zero changes.

### Gate 6 — No parity-fixture mutation

```bash
git diff --stat main..HEAD -- tests/fixtures/live-smoke/86557df1-
```

Expected: zero changes.

### Gate 7 — `pluto:run --spec <path>` works end-to-end (mock)

Manual or scripted check using
`packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/scenario.yaml`
with a mock paseo client. Exits 0; evidence packet written.

### Gate 8 — `--runtime=v1` exits 1 with archived message

Asserted by `tests/cli/run-v1-flag-archived.test.ts`. Stderr MUST
contain the literal string `legacy-v1.6-harness-prototype`.

### Gate 9 — Diff hygiene + post-merge legacy-branch sanity

`git diff --name-only main..HEAD` MUST be a subset of:

Deletions (per section C list):

- `src/adapters/paseo-opencode/**`, `src/four-layer/**`,
  `src/orchestrator/**`, `src/contracts/**`, `src/runtime/**`.
- `src/cli/package.ts`, `src/cli/runs.ts`, `src/cli/submit.ts`,
  any other v1-only `src/cli/*.ts`.
- `docker/live-smoke.ts`, `scripts/verify.mjs` (or rewrite).
- v1.6 test files per section C.
- `scenarios/**`, `playbooks/**`, `run-profiles/**`, `agents/**`,
  `evals/**`.

Surgery / rewrites:

- `src/cli/run.ts`, `src/cli/shared/flags.ts`,
  `src/cli/shared/run-selection.ts` (where applicable).
- `src/index.ts` (v1 export removal OR full delete).
- `tests/cli/run-runtime-precedence.test.ts` (rewrite).
- `tests/cli/run-unsupported-scenario.test.ts` (rewrite).
- `package.json` (script removals).
- 9 doc files (per section F).

Adds:

- `tests/cli/run-v1-flag-archived.test.ts`.
- `docs/design-docs/v1-archive.md`.
- `tasks/remote/pluto-v2-s7-archive-legacy-20260508/**` (this
  bundle).

Out-of-scope (post-merge by local manager):

- `docs/plans/active/v2-rewrite.md` — S7 status row only AFTER
  merge.
- Plan-file move active → completed.

Post-merge re-check: `git ls-remote origin
refs/heads/legacy-v1.6-harness-prototype` returns the SAME SHA
recorded in `legacy-branch-sha-pre.txt`; record to
`legacy-branch-sha-post.txt`.

## Last updated

2026-05-08 — Discovery R1 → R2 READY_FOR_DISPATCH; bundle ready.
