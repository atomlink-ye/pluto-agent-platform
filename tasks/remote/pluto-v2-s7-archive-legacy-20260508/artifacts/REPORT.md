# S7 — Archive legacy mainline runtime — final report

## Sandbox / commit + push state

- Sandbox: `c8ef5890-f1d2-4f53-a76d-b6ec6ae38549` (warm, snapshot
  `personal-dev-env-vps-5c10g150g`).
- Branch: `pluto/v2/s7-archive-legacy` (local rename from sandbox
  `pluto/v2/s7-archive-legacy-c8ef58`; bundled patch applied
  locally then pushed from local because the sandbox push auth
  blocked, same pattern as S6).
- Branch HEAD on origin: see `branch-head.txt` (sandbox HEAD
  `cdef642…` was the gate-green commit; local rebase + orphan
  fix-up + acceptance fix-up advanced HEAD).

## Pre-flight + post-merge legacy-branch SHA

- Pre-flight (`legacy-branch-sha-pre.txt`):
  `feb5d59d2ac7d3d790c4d3e04962958416a12ffa`.
- Post-flight (`legacy-branch-sha-post.txt`): same SHA.
- Post-merge re-check by local manager required before status
  row close.

## Lane 0 inventory

- `v1.6-inventory.md` enumerates every file under `src/`, `tests/`,
  `scripts/`, `docker/`, `scenarios/`, `playbooks/`,
  `run-profiles/`, `agents/`, `evals/` with KEEP / DELETE /
  REWRITE labels.
- Mechanism: `tsc --listFiles -p tsconfig.json` filtered, cross-
  checked against `package.json` script references and
  `vitest.config.ts` include patterns.
- R3 retained-entrypoint set under `src/`: only
  `src/cli/run.ts`, `src/cli/v2-cli-bridge.ts`,
  `src/cli/v2-cli-bridge-error.ts`,
  `src/cli/shared/flags.ts`. `src/index.ts` and
  `src/cli/shared/run-selection.ts` were both deleted entirely
  because no consumer remained.

## Scope per deliverable

- Deliverable 1 (lane 0 inventory): produced before deletion.
- Deliverable 2 (deletion list): R3-expanded — every src/ subdir
  except retained set; full v1.6 product surface (audit /
  bootstrap / catalog / compliance / evidence / extensions /
  governance / identity / integration / observability / ops /
  portability / portable-workflow / publish / release / review /
  schedule / security / storage / store / versioning) deleted
  cascadingly with `src/contracts/`. v1.6 auxiliary CLI
  (`src/cli/{package,runs,submit}.ts`) removed.
  `docker/live-smoke.ts`, `scripts/verify.mjs`, all v1.6 tests,
  all v1.6 authored configs (`scenarios/`, `playbooks/`,
  `run-profiles/`, `agents/`, `evals/`) removed. Root
  `package.json` v1.6 scripts removed.
- Deliverable 3 (CLI router surgery): `src/cli/run.ts` reduced to
  v2-only routing; `--runtime=v1`, `--scenario`, `--playbook`,
  `--run-profile`, `PLUTO_RUNTIME=v1` all exit 1 with archived
  message containing `legacy-v1.6-harness-prototype`.
  `--runtime=v2` silently accepted (one transition window).
- Deliverable 4 (tests): `run-runtime-precedence.test.ts` and
  `run-unsupported-scenario.test.ts` rewritten;
  `run-v1-flag-archived.test.ts` new (covers all 5 archived
  paths); v1.6 test files + cascaded helpers/fixtures deleted.
  Local fix-up removed 6 orphan helpers
  (`tests/fixtures/{compliance-export-flow,review-publish-release}.ts`,
  `tests/helpers/{harness-run-fixtures,mailbox-fixtures,process-runner}.ts`,
  `tests/integration/r6-fixtures.ts`) the remote agent missed.
- Deliverable 5 (docs): all 9 docs updated (README, AGENTS,
  ARCHITECTURE, DESIGN, RELIABILITY, SECURITY, mvp-alpha, harness,
  testing-and-evals, qa-checklist); new
  `docs/design-docs/v1-archive.md`;
  `docs/design-docs/v2-cli-default-switch.md` re-headed as
  historical and the stale `use --runtime=v1 for legacy specs`
  closure replaced with the legacy-branch pointer.
- Deliverable 6 (invariants): typecheck / test / build clean;
  legacy branch SHA stable; v2 packages and parity fixture
  untouched.

## Closure proofs (acceptance gates)

- Gate 0 (legacy branch SHA): pre/post artifacts both contain
  `feb5d59d2ac7d3d790c4d3e04962958416a12ffa`.
- Gate 1 (lane 0 inventory): `artifacts/v1.6-inventory.md`
  present.
- Gate 2 (typecheck): root + v2-core + v2-runtime exit 0 (local
  re-verified post-fix-up).
- Gate 3 (tests): v2-core 186 / v2-runtime 65 / root 32 — all
  green.
- Gate 4 (build): both v2 package builds clean.
- Gate 5 (no v2-package mutation):
  `git diff --stat main..HEAD -- packages/` empty.
- Gate 6 (no parity-fixture mutation):
  `git diff --stat main..HEAD -- tests/fixtures/live-smoke/86557df1-*`
  empty.
- Gate 7 (`pluto:run --spec=<path>` works): covered by
  `tests/cli/run-runtime-v2-default.test.ts` PASS.
- Gate 8 (`--runtime=v1` archived message): covered by
  `tests/cli/run-v1-flag-archived.test.ts` PASS (all 5 paths
  contain `legacy-v1.6-harness-prototype`).
- Gate 9 (diff hygiene): bundle committed; no extraneous tests
  beyond `run-v1-flag-archived.test.ts`; no docs beyond the
  9-doc sync + `v1-archive.md` + historical re-head of
  `v2-cli-default-switch.md`.

## Files changed (counts)

- Sandbox-side: 483 files / +444 / −88,433 (HEAD `bc7a9fc`).
- Local fix-up 1: 6 files / −846 (HEAD `84aa3d8` — orphan helpers
  the remote agent missed; surfaced by root typecheck).
- Local fix-up 2: 4 files modified (acceptance round —
  `v2-cli-bridge.ts` legacy-pointer message;
  `run-unsupported-scenario.test.ts` legacy-pointer assertion;
  `v2-cli-default-switch.md` historical re-head; bundle commit).

## Validation gate output paths

- `gate-typecheck-{core,runtime,root}.txt`
- `gate-test-{core,runtime,root}.txt`
- `gate-build-{core,runtime}.txt`
- `gate-no-packages-mutation.txt`
- `gate-no-parity-fixture-mutation.txt`
- `legacy-branch-sha-pre.txt`, `legacy-branch-sha-post.txt`
- `lane0-{tsc-listfiles,all-src-files,package-json-scripts,vitest-include}.txt`
- `v1.6-inventory.md`
- `diff.patch`, `diff-stat.txt`, `branch-head.txt`

Note: `gate-typecheck-root.txt` from the sandbox shows exit 2
because the remote agent missed the 6 orphan test helpers. Local
re-verification post-fix-up is clean (typecheck root exit 0,
tests 32 / 32 PASS, builds clean). The sandbox artifact is
preserved as evidence of the surfaced regression.

## Remote review loop summary

- Discovery R1 STOP_AND_ASK → R2 READY_FOR_DISPATCH (8 fixes).
- R3 scope expansion after lane 0 surfaced 73+ non-delete files
  chained on `src/contracts/`. Operator's binding aggressive-
  replacement rule applied.
- Remote root manager session reused (paseo agent
  `22c2107d-b8a5-4009-b5b7-5114678bc57f`) across R1→R3.
- Push auth failure on sandbox at end of R3 — patch pulled to
  local, applied, fixed-up, pushed.
- Local acceptance review (`@oracle` + `@council`) returned
  NEEDS_FIX with 4 objections: bundle not committed; stale
  `--runtime=v1` in `v2-cli-bridge`; stale assertion in
  `run-unsupported-scenario.test.ts`; stale doc
  `v2-cli-default-switch.md`. All four addressed in this
  fix-up round.

## Known issues / suggested local inspection

- v1.6 product surface (audit / compliance / governance / etc)
  features are gone. Any feature still required on `main` must
  be re-implemented v2-shaped in a separate post-S7 slice.
  Recovery from `legacy-v1.6-harness-prototype` is git-cheap.
- `docs/plans/active/v2-rewrite.md` still lives at `active/`; the
  local manager moves it to `completed/` in a separate plan-status
  commit AFTER S7 merges (NOT in the slice diff).
