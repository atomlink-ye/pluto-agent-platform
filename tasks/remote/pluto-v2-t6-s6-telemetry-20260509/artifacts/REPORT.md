# T6-S6 Report

## Scope

- Updated `packages/pluto-v2-runtime/src/evidence/usage-summary-builder.ts` so unavailable usage now serializes as `null`, adds `usageStatus: available | unavailable | partial`, and derives truthful actor/model totals from per-turn availability.
- Updated `packages/pluto-v2-runtime/src/evidence/evidence-packet.ts` to expose `runtimeDiagnostics` with `bridgeUnavailable`, `taskCloseoutRejected`, and `waitTraces`.
- Updated `packages/pluto-v2-runtime/src/evidence/final-report-builder.ts` and `src/cli/v2-cli-bridge.ts` so final reports include a Diagnostics section only when failure-flavor runtime traces are present.
- Threaded `runtimeTraces` into evidence packet assembly from `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts` without changing the existing runtime `reported | unavailable` adapter contract.
- Added evidence coverage in `packages/pluto-v2-runtime/__tests__/evidence/usage-summary-builder.test.ts`, `packages/pluto-v2-runtime/__tests__/evidence/evidence-packet.test.ts`, and `packages/pluto-v2-runtime/__tests__/evidence/final-report-builder.test.ts`.

## Verification

- `pnpm --filter @pluto/v2-runtime exec vitest run __tests__/evidence/usage-summary-builder.test.ts __tests__/evidence/evidence-packet.test.ts __tests__/evidence/final-report-builder.test.ts` -> pass (`8/8`)
- `bash tasks/remote/pluto-v2-t6-s6-telemetry-20260509/commands.sh gate_no_kernel_mutation` -> pass
- `bash tasks/remote/pluto-v2-t6-s6-telemetry-20260509/commands.sh gate_no_predecessor_mutation` -> pass
- `bash tasks/remote/pluto-v2-t6-s6-telemetry-20260509/commands.sh gate_diff_hygiene` -> pass
- `bash tasks/remote/pluto-v2-t6-s6-telemetry-20260509/commands.sh gate_test` -> runtime pass (`207/209`, 2 skipped), root baseline fail (`27/37`) due pre-existing `zod` module/export failures before CLI assertions
- `bash tasks/remote/pluto-v2-t6-s6-telemetry-20260509/commands.sh gate_typecheck` -> runtime baseline fail before root typecheck artifact emission
- `pnpm exec tsc -p tsconfig.json --noEmit` -> baseline fail on existing `zod` export/typecheck issues outside this slice

## Baseline Issues Observed

- The N2 grep gate still fails on the retained captured fixture transcripts under `tests/fixtures/live-smoke/029db445-aa2b-406e-ad16-fde7fb45e51d/`.
- Runtime and root typecheck are still blocked by broader pre-existing `zod` resolution/export failures plus unrelated typing errors outside the T6-S6 diff.
- Root CLI tests fail from the same baseline `zod` startup issue before reaching the new telemetry assertions.
