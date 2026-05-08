# Context Index — pluto-v2-s7-archive-legacy-20260508

## Plan + handoff (canonical)

- `docs/plans/active/v2-rewrite.md` — section "S7 — Phase 7:
  Archive legacy mainline runtime code (final slice)" canonical
  at HEAD on `main` `3a931fd`.
- `tasks/remote/pluto-v2-s7-archive-legacy-20260508/HANDOFF.md`
- `tasks/remote/pluto-v2-s7-archive-legacy-20260508/acceptance.md`
- `tasks/remote/pluto-v2-s7-archive-legacy-20260508/env-contract.md`
- `tasks/remote/pluto-v2-s7-archive-legacy-20260508/prompt.md`
- `tasks/remote/pluto-v2-s7-archive-legacy-20260508/commands.sh`
- `tasks/remote/pluto-v2-s7-archive-legacy-20260508/context/v2-rewrite-handoff.md`
- `tasks/remote/pluto-v2-s7-archive-legacy-20260508/context/operating-rules.md`

## Reference branch (READ-ONLY; pre-flight + post-merge check)

- `legacy-v1.6-harness-prototype` on origin. NEVER push, NEVER
  delete, NEVER mutate. SHA captured pre-deletion and re-checked
  post-merge.

## Read-only retained surface

### v2 packages (UNTOUCHED)

- `packages/pluto-v2-core/**`.
- `packages/pluto-v2-runtime/**`.
- `tests/fixtures/live-smoke/86557df1-...` (parity oracle data).

### v2 CLI bridge (S6 output; UNTOUCHED unless surgery requires)

- `src/cli/v2-cli-bridge.ts` — V2BridgeInput / Result / Deps +
  `runViaV2Bridge`.
- `src/cli/v2-cli-bridge-error.ts` — `classifyPaseoError` shim.

### v2-only tests retained UNTOUCHED

- `tests/cli/run-runtime-v2-default.test.ts`.
- `tests/cli/run-exit-code-2-v2.test.ts`.

## Surgery targets

- `src/cli/run.ts` — remove v1 routing entirely; `--spec=<path>`
  becomes the only invocation; v1 selectors → archived message
  exit 1.
- `src/cli/shared/flags.ts` — drop v1-only handling (audit).
- `src/cli/shared/run-selection.ts` — drop v1-only handling
  (likely deletion-only since v2 only takes `--spec`).
- `src/index.ts` lines 129-139 — v1 exports removed; file
  becomes v2-only re-exports OR fully deleted if no consumer.
- `tests/cli/run-runtime-precedence.test.ts` — REWRITE.
- `tests/cli/run-unsupported-scenario.test.ts` — REWRITE.
- Root `package.json` scripts — remove `pluto:run:v1`,
  `pluto:package`, `pluto:runs`, `pluto:submit`, and
  `smoke:fake/live`/`verify*` entries pointing at deleted v1.6
  paths.

## Deletion targets (entire files / directories)

Source code: `src/adapters/paseo-opencode/`, `src/four-layer/`,
`src/orchestrator/`, `src/contracts/`, `src/runtime/`.

CLI: `src/cli/package.ts`, `src/cli/runs.ts`,
`src/cli/submit.ts`, plus any other v1-only `src/cli/*.ts`.

Infra: `docker/live-smoke.ts`, `scripts/verify.mjs` (or rewrite).

Tests: `tests/cli/run.test.ts`, `tests/cli/run-exit-code-2.test.ts`,
`tests/cli/run-runtime-v1-opt-in.test.ts`,
`tests/cli/runs.test.ts`, `tests/manager-run-harness.test.ts`,
`tests/paseo-opencode-adapter.test.ts`,
`tests/prompt-collar.test.ts`,
`tests/four-layer-loader-render.test.ts`,
`tests/fake-adapter.test.ts`, `tests/orchestrator/**`,
`tests/live-smoke-classification.test.ts`, plus any other
v1.6-only tests discovered by lane 0 inventory.

Authored configs (entire dirs): `scenarios/`, `playbooks/`,
`run-profiles/`, `agents/`, `evals/`.

## New artifacts

- `tests/cli/run-v1-flag-archived.test.ts` — explicit
  archived-message coverage.
- `docs/design-docs/v1-archive.md` — short doc on archive
  decision + legacy-branch fetch instructions.

## Doc sweep (9 files)

- `README.md`, `AGENTS.md`, `ARCHITECTURE.md`, `DESIGN.md`,
  `RELIABILITY.md`, `SECURITY.md`, `docs/mvp-alpha.md`,
  `docs/harness.md`, `docs/testing-and-evals.md`,
  `docs/qa-checklist.md`.

## Lane 0 inventory mechanism

`tsc --listFiles -p tsconfig.json` from the retained-entrypoint
set; filter to `src/`, `tests/`, `docker/`, `scripts/`. Files NOT
emitted from retained entrypoints are DELETE candidates. Cross-
check against `package.json` script references and Vitest include
patterns. Output committed to
`tasks/remote/pluto-v2-s7-archive-legacy-20260508/artifacts/v1.6-inventory.md`
BEFORE deletion lands.

## Repository

- GitHub: <https://github.com/atomlink-ye/pluto-agent-platform>
- `main` HEAD: `3a931fd` (S7 plan with R1 fixes; R2
  READY_FOR_DISPATCH).
- Prior slice merges: S6 `bb85638`, S5 `c1a3872`, S4 `f9d0df4`,
  S3 `44594f8`, S2 `41f82e9`, S1 `c9bc46f`.

## Reading order

1. `docs/plans/active/v2-rewrite.md` S7 section.
2. `acceptance.md` (this bundle) — gates 0–9.
3. `prompt.md` (this bundle).
4. `env-contract.md` (this bundle).
5. `commands.sh` (this bundle).
6. `src/cli/run.ts` (current v1+v2 router; surgery target).
7. `src/cli/v2-cli-bridge.ts` + `v2-cli-bridge-error.ts`
   (UNTOUCHED reference).
8. `packages/pluto-v2-runtime/src/index.ts` (UNTOUCHED public
   surface).
