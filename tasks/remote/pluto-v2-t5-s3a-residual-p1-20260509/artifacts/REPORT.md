# T5-S3a Report

## process.cwd() audit

- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts:502`
  - Leaf fallback: `const workspaceCwd = options.workspaceCwd ?? process.cwd()`.
  - Call trace for the root CLI entrypoint: `src/cli/run.ts` -> `src/cli/v2-cli-bridge.ts:471-483` -> `runPaseo(..., { workspaceCwd: input.workspaceCwd })` -> `run-paseo.ts:973-980` -> `runAgenticToolLoop(..., { workspaceCwd: options.workspaceCwd })` -> `run-paseo.ts:502`.
  - Verdict: no P1 on the supported root CLI path. `--workspace` is passed explicitly, so the fallback is unreachable for the mainline entrypoint.
- `packages/pluto-v2-runtime/src/api/**`
  - Audit result: no `runPaseo(` caller under `src/api/**`.
  - Verdict: no HTTP-entrypoint path can reach the fallback with `workspaceCwd === undefined`.
- `packages/pluto-v2-runtime/src/loader/authored-spec-loader.ts:128,247`
  - `<inline>` synthetic `specPath` uses `process.cwd()` only for cosmetic placeholder paths.
  - Verdict: not a workspace-derivation bypass; left unchanged per scope.
- `packages/pluto-v2-runtime/scripts/smoke-live.ts:315-321`
  - This script still calls `runPaseo(...)` without `workspaceCwd`.
  - Verdict: noted but not treated as the S3a P1, because the slice target was the supported CLI / HTTP entrypoint path and `scripts/smoke-live.ts` is outside the allowed edit surface for this dispatch.

## Test refactor

- Updated `tests/cli/run-runtime-v2-default.test.ts`.
- Replaced the agentic fake Paseo fixture's hand-rolled HTTP `fetch` + `Pluto-Run-Actor` header construction with a thin wrapper that shells out to `pluto-tool`.
- The wrapper maps the mock tool intents used by the fixture to the real CLI surface:
  - `pluto_create_task` -> `pluto-tool create-task`
  - `pluto_append_mailbox_message` -> `pluto-tool send-mailbox`
  - `pluto_complete_run` -> `pluto-tool complete-run`
- Result: the test still exercises the same v2 default runtime path, but the actor-side fixture now uses the canonical CLI + env handoff instead of leaking HTTP details.

## Docs updated

- `docs/harness.md`
  - Added an `Actor API` section naming `pluto-tool` as the canonical actor entrypoint.
  - Documented injected env vars: `PLUTO_RUN_API_URL`, `PLUTO_RUN_TOKEN`, `PLUTO_RUN_ACTOR`.
  - Listed the actor-facing CLI commands, including `wait`, and linked the T5 wait provenance docs.
- `README.md`
  - Added an `Authoring Playbooks` example showing actor instructions that use `pluto-tool`.
  - Included mailbox completion handoff via `pluto-tool send-mailbox`.

## Gates

- `pnpm install`
  - Ran via `tasks/remote/pluto-v2-t5-s3a-residual-p1-20260509/commands.sh bootstrap`.
- `pnpm --filter @pluto/v2-runtime typecheck`
  - Exit: 2.
  - Observed baseline failure set retained; no new errors from touched files.
- `pnpm exec tsc -p tsconfig.json --noEmit`
  - Observed baseline root typecheck failures; no errors reported from `tests/cli/run-runtime-v2-default.test.ts`, `docs/harness.md`, or `README.md`.
  - Typecheck new errors: 0.
- `pnpm --filter @pluto/v2-runtime test`
  - Exit: 1.
  - Result count: 165 passed / 172 total, 2 skipped.
  - Observed failures remained in pre-existing runtime lanes outside this slice's edited files.
- `pnpm test`
  - Exit: 1.
  - Result count: 27 passed / 35 total.
  - Matches the stated root-test baseline failure count of 8.
- `pnpm --filter @pluto/v2-runtime build`
  - Exit: 2.
  - Observed baseline build/typecheck failure set retained.

## Diff hygiene

- Intended branch diff after commit is limited to:
  - `tests/cli/run-runtime-v2-default.test.ts`
  - `docs/harness.md`
  - `README.md`
  - `tasks/remote/pluto-v2-t5-s3a-residual-p1-20260509/artifacts/REPORT.md`
- No `packages/pluto-v2-core/**` changes.
- No `packages/pluto-v2-runtime/src/**` changes were required.
