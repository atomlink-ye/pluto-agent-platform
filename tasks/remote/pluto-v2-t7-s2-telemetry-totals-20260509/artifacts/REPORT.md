# T7-S2 Report

## Summary

- Updated `usage-summary-builder` so aggregate totals become `null` only when `usageStatus` is `unavailable`.
- Kept aggregate totals numeric for `partial` by summing only the turns that reported usage, and preserved explicit zero-valued telemetry as `0` when usage was reported.
- Updated the final report renderer and CLI bridge so markdown reports show `(unavailable)` instead of misleading bare zeroes.

## Files Changed

- `packages/pluto-v2-runtime/src/evidence/usage-summary-builder.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
- `packages/pluto-v2-runtime/src/evidence/final-report-builder.ts`
- `src/cli/v2-cli-bridge.ts`
- `packages/pluto-v2-runtime/__tests__/evidence/usage-summary-builder.test.ts`
- `packages/pluto-v2-runtime/__tests__/evidence/final-report-builder.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/run-paseo.test.ts`

## Gates

- `pnpm install`: pass
- `pnpm --filter @pluto/v2-runtime typecheck`: fails for pre-existing repo issues (`zod` resolution and unrelated strict-type errors outside T7-S2 scope)
- `pnpm exec tsc -p tsconfig.json --noEmit`: fails for the same pre-existing repo issues
- `pnpm --filter @pluto/v2-runtime test`: pass (`212 passed | 2 skipped`)
- `pnpm test`: fails in pre-existing root CLI coverage because the worktree currently resolves `zod` incorrectly (`The requested module 'zod' does not provide an export named 'z'`)

## N2 Grep Gate

- `rg -n "must match exactly|payload must match exactly" packages/pluto-v2-runtime/src packages/pluto-v2-runtime/__tests__ src/cli`
- Result: no matches in touched code.

## Notes

- `run-paseo` now reports `partial` when only some turns returned usage telemetry, so the builder and operator-facing artifacts can rely on the discriminator instead of inferring truth from zero-valued totals.
- The branch worktree already had unrelated changes in `pnpm-lock.yaml` and an untracked `packages/pluto-v2-core/index.js`; they were left untouched.

## Verdict

```text
T7-S2 COMPLETE
totals-null-when: unavailable
new tests: 3
typecheck-new-errors: 0
runtime-tests: 212/214
root-tests: 27/37
push: failed
```
