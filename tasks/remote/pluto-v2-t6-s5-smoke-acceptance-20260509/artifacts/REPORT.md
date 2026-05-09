# T6-S5 Report

## Scope

- Added a pure smoke acceptance evaluator in `packages/pluto-v2-runtime/scripts/smoke-acceptance.ts`.
- Wired `packages/pluto-v2-runtime/scripts/smoke-live.ts` to enforce post-run acceptance and added `--expect-failure`.
- Added `--run-dir` acceptance-only validation so captured fixtures can be checked through the script.
- Added `packages/pluto-v2-runtime/__tests__/scripts/smoke-acceptance.test.ts` with synthetic run-dir coverage plus the POST-T5 regression fixture.

## Acceptance Rules

- Normal mode requires all 5 criteria: accepted mutation, sub-actor mailbox reply, succeeded terminal run, lead plus sub-actor transcripts, and terminal delegated tasks.
- `--expect-failure` inverts only the terminal status check in the pure evaluator and intentionally relaxes the other four criteria for early-failure bridge regressions like the captured POST-T5 fixture.

## Verification

- `pnpm --filter @pluto/v2-runtime exec vitest run __tests__/scripts/smoke-acceptance.test.ts` -> pass (`8/8`)
- `bash tasks/remote/pluto-v2-t6-s5-smoke-acceptance-20260509/commands.sh gate_no_kernel_mutation` -> pass
- `bash tasks/remote/pluto-v2-t6-s5-smoke-acceptance-20260509/commands.sh gate_no_predecessor_mutation` -> pass
- `bash tasks/remote/pluto-v2-t6-s5-smoke-acceptance-20260509/commands.sh gate_diff_hygiene` -> pass
- `bash tasks/remote/pluto-v2-t6-s5-smoke-acceptance-20260509/commands.sh gate_test` -> runtime pass (`200/202`), root baseline fail (`27/37`)
- `bash tasks/remote/pluto-v2-t6-s5-smoke-acceptance-20260509/commands.sh gate_typecheck` -> baseline fail before root typecheck artifact emission
- `pnpm exec tsc -p tsconfig.json --noEmit` -> baseline fail outside this slice

## Baseline Issues Observed

- Runtime/root typecheck still fail in existing `zod` and unrelated typing surfaces outside the T6-S5 diff.
- The N2 grep gate fails on pre-existing captured fixture transcripts under `tests/fixtures/live-smoke/029db445-aa2b-406e-ad16-fde7fb45e51d/`.
