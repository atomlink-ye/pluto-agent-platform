# T10-S2 Report

## Summary
T10-S2 is wired into `smoke-live` at post-run analysis time. The existing polling heuristic in `scripts/smoke-acceptance.ts` now exposes structured detections, and `scripts/smoke-live.ts` invokes it both for fresh live runs and for `--run-dir` analysis before acceptance reporting.

When polling is detected, `smoke-live` now prints a dedicated failure header plus one structured `polling_detected` line per actor and exits non-zero with code `7`. The helper-level regression test added for this slice covers both the polling and clean transcript cases.

The requested fast-path gates were run. Typecheck and build gates passed cleanly. Two broader test-suite failures remain, both outside the T10-S2 diff and outside the files this slice is allowed to change: one runtime predecessor-area failure in `__tests__/adapters/paseo/task-closeout.test.ts`, and one root CLI failure in `tests/cli/run-runtime-v2-default.test.ts`.

## What changed
- `packages/pluto-v2-runtime/scripts/smoke-acceptance.ts`
  Added a structured polling helper export (`detectPollingBetweenMutations`) and formatter (`formatPollingDetection`), then kept acceptance behavior by mapping detections back to the existing `polling_detected: ...` failure strings.
- `packages/pluto-v2-runtime/scripts/smoke-live.ts`
  Added the post-run polling gate, wired it into both the live-run path and the `--run-dir` analysis path, and made polling fail `smoke-live` with exit code `7`.
- `packages/pluto-v2-runtime/__tests__/scripts/smoke-live-polling-gate.test.ts`
  Added a focused helper-level regression test for polling detection and the clean-path case.
- `tasks/remote/pluto-v2-t10-s2-smoke-live-polling-gate-20260509/artifacts/REPORT.md`
  Recorded implementation details, decisions, gate results, and remaining unrelated failures.

## Decisions made
- **Helper extraction strategy**: chose `extract` because `smoke-live` needs structured polling details (actor, prior mutation event id, read-state count), and exporting the existing logic from `smoke-acceptance.ts` kept the change inside the allowed 2 script files.
- **Allowlist runIds**: none. I kept an explicit hardcoded allowlist container in `smoke-live.ts`, then scanned the usable `tests/fixtures/live-smoke/*` captures with the extracted helper and found no current fixture that actually trips the detector.
- **smoke-live exit code on polling**: chose `7` because the prompt explicitly allowed a smoke-live-specific code and this keeps polling failures distinct from generic acceptance or runtime failures.
- **run-dir coverage**: also applied the polling gate to `smoke-live.ts --run-dir ...` so post-run analysis is consistent whether the run is freshly captured or replayed from a saved fixture directory.
- **Gate handling**: kept predecessor-area and root-suite failures documented rather than widened scope into forbidden files.

## Approaches considered and rejected
- Reusing only `checkSmokeAcceptanceForRunDir(...)` in `smoke-live` without extracting structured polling data: rejected because `smoke-live` needs actor-level structured error output, not just opaque acceptance strings.
- Parsing `polling_detected: ...` strings back into fields inside `smoke-live`: rejected because it adds avoidable string-coupling when the detector can return typed data directly.
- Adding a per-fixture `polling_allowed: true` flag in scenario data: rejected because the prompt directed this slice toward the simpler hardcoded allowlist approach.
- Carrying a placeholder allowlisted runId after the fixture scan came back clean: rejected so the gate remains strict by default and the report can truthfully state that no current usable fixture needed exemption.
- Fixing unrelated runtime/root test failures in this slice: rejected because both failures are outside the diff hygiene allowlist and outside the predecessor surfaces this prompt forbids touching.

## Stop conditions hit
- none

## Gates
- `pnpm install`
  Not rerun here because bootstrap, zod shim restoration, and bundle sync were already completed before handoff per the task prompt.
- `pnpm --filter @pluto/v2-core build`
  Passed. Artifact: `tasks/remote/pluto-v2-t10-s2-smoke-live-polling-gate-20260509/artifacts/gate-build-v2-core.txt`.
- `pnpm --filter @pluto/v2-runtime typecheck:src`
  Passed cleanly in 5s. Artifact: `tasks/remote/pluto-v2-t10-s2-smoke-live-polling-gate-20260509/artifacts/gate-typecheck-runtime-src.txt`.
- `pnpm --filter @pluto/v2-runtime typecheck:test`
  Passed cleanly in 7s. Artifact: `tasks/remote/pluto-v2-t10-s2-smoke-live-polling-gate-20260509/artifacts/gate-typecheck-runtime-test.txt`.
- `pnpm exec tsc -p tsconfig.json --noEmit`
  Passed cleanly. Artifact: `tasks/remote/pluto-v2-t10-s2-smoke-live-polling-gate-20260509/artifacts/gate-typecheck-root.txt`.
- `pnpm --filter @pluto/v2-runtime test`
  Failed outside this slice's diff. Result: `1 failed | 249 passed | 2 skipped (252)`. Failing test: `packages/pluto-v2-runtime/__tests__/adapters/paseo/task-closeout.test.ts` expecting the pre-T10-S1 wait trace sequence. Artifact: `tasks/remote/pluto-v2-t10-s2-smoke-live-polling-gate-20260509/artifacts/gate-test-runtime.txt`.
- `pnpm test`
  Failed outside this slice's diff. Result: `1 failed | 36 passed (37)`. Failing test: `tests/cli/run-runtime-v2-default.test.ts` (`defaults to v2 and writes the run-directory evidence outputs when --spec is passed`). This command was run directly after the runtime suite because the bundled `gate_test` step stops after the runtime failure and therefore does not emit `gate-test-root.txt`.
- `gate_no_kernel_mutation`
  Passed.
- `gate_no_predecessor_mutation`
  Passed.
- `gate_no_verbatim_payload_prompts`
  Passed.
- `gate_no_cross_package_src_imports`
  Passed.
- `gate_diff_hygiene`
  Passed.
- Focused slice verification
  `pnpm --filter @pluto/v2-runtime exec vitest run __tests__/scripts/smoke-live-polling-gate.test.ts` passed (`2/2`).
- Fixture replay verification
  `pnpm --filter @pluto/v2-runtime exec tsx scripts/smoke-live.ts --run-dir tests/fixtures/live-smoke/post-t5-poet-critic-haiku --expect-failure` returned successfully.
- Fixture scan verification
  A direct helper scan over the usable `tests/fixtures/live-smoke/*` captures produced no polling detections, which is why the explicit allowlist remained empty.

## Verdict
T10-S2 implementation is complete and scoped correctly: `smoke-live` now runs the polling detector at post-run analysis time and fails with structured output plus exit code `7` when polling is found. The slice-local helper regression test passes, typecheck/build/guard gates pass, and the remaining runtime/root suite failures are unrelated baseline issues outside the files this slice is allowed to modify.
