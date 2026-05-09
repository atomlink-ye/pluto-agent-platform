# T8-S1 Report

## Summary

- Switched `runPaseo` usage accumulation from `0`-seeded math to `null`-seeded `nullSafeSum` aggregation so unavailable usage stays `null` in raw runtime totals and `byActor` rollups.
- Updated `usage-summary-builder.ts` so per-turn, `byActor`, and `byModel` `totalTokens` are null-aware and unavailable aggregates stay `null` instead of collapsing to `0`.
- Added end-to-end regressions in runtime tests, builder tests, and smoke acceptance, and refreshed the captured `post-t5-poet-critic-haiku` fixture to the new null shape.

## Files Changed

- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
- `packages/pluto-v2-runtime/src/evidence/usage-summary-builder.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/run-paseo.test.ts`
- `packages/pluto-v2-runtime/__tests__/evidence/usage-summary-builder.test.ts`
- `packages/pluto-v2-runtime/__tests__/scripts/smoke-acceptance.test.ts`
- `tests/fixtures/live-smoke/post-t5-poet-critic-haiku/usage-summary.json`

## Validation

### Targeted regressions

- `pnpm --filter @pluto/v2-runtime test -- __tests__/evidence/usage-summary-builder.test.ts __tests__/adapters/paseo/run-paseo.test.ts __tests__/scripts/smoke-acceptance.test.ts`
- Result: `25/25` tests passed.

### Required gates

- `pnpm install`
  - Passed.
- `pnpm --filter @pluto/v2-runtime typecheck`
  - Fails on existing repo baseline issues outside this slice, including missing `zod` resolution in `packages/pluto-v2-core/**` and a pre-existing `run-paseo.ts(611,39)` assignability error.
- `pnpm exec tsc -p tsconfig.json --noEmit`
  - Fails on the same existing repo baseline issues.
- `pnpm --filter @pluto/v2-runtime test`
  - Result: `220/222` passed.
  - Remaining failures match the stated baseline pattern and are outside T8-S1:
    - `__tests__/api/pluto-local-api.wait.test.ts`
    - `__tests__/adapters/paseo/task-closeout.test.ts`
- `pnpm test`
  - Result: `37/37` passed on rerun.

## Notes

- The requested `/tmp/post-t7-validation/.../usage-summary.json` artifact was not present in this worktree session, so validation used the checked-in `post-t5-poet-critic-haiku` smoke fixture and direct runtime/builder tests instead.
