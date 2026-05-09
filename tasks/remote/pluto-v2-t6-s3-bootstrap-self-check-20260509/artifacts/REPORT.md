# T6-S3 Report

## Scope

- Added `packages/pluto-v2-runtime/src/adapters/paseo/bridge-self-check.ts` with a synchronous wrapper self-check that classifies `wrapper_missing`, `nonzero_exit`, `timeout`, `invalid_response`, and `other`.
- Wired cached bridge self-check handling into `run-paseo.ts` with a manager-authored `complete_run` fail-fast path and a structured `bridge_unavailable` runtime trace.
- Hardened `actor-bridge.ts` so the wrapper stays self-contained under `env: {}`:
  - linked the `zod` dependency for source-based core imports
  - added a lightweight `read-state` fast path
  - added a temporary `.pluto/self-check-state.json` sidecar path used only during bootstrap probing
- Added `bridge-self-check.test.ts` and a run-level failure test in `agentic-tool-loop.test.ts`.

## Design Notes

- The self-check is cached once per non-manager actor key during adapter preflight, before the agent loop starts. This preserves fail-fast behavior and avoids interfering with parked wait HTTP flows during delegated turns.
- The manager-synthesized failure path uses the existing `buildCompleteRunRequest()` authority path, so cleanup and evidence assembly stay unchanged.
- The runtime trace includes `actor`, `attemptedAt`, `reason`, `stderr`, and `latencyMs`.

## Gates

- `pnpm install`: passed via `commands.sh bootstrap`
- `pnpm --filter @pluto/v2-runtime test`: passed, `190 passed | 2 skipped (192)`
- `pnpm test`: failed on existing root CLI baseline, `27 passed / 10 failed`; failures are unrelated `zod`/CLI baseline issues outside T6-S3 scope
- `pnpm --filter @pluto/v2-runtime typecheck`: failed on existing repo baseline (`zod` export/type issues); the T6-S3-specific `run-paseo.ts` errors introduced during implementation were resolved
- `pnpm exec tsc -p tsconfig.json --noEmit`: failed on the same existing repo-wide `zod`/type baseline
- `gate_no_kernel_mutation`: passed
- `gate_no_predecessor_mutation`: passed
- `gate_diff_hygiene`: passed
- `gate_no_verbatim_payload_prompts`: failed on existing `tests/fixtures/live-smoke/**` transcript text outside this slice

## Diff Hygiene

- Branch diff is limited to the allowed runtime adapter/test/report files for T6-S3.
- `pnpm-lock.yaml` was modified by bootstrap in the worktree but was not included in the T6-S3 branch diff.

## Test Additions

- New file: `packages/pluto-v2-runtime/__tests__/adapters/paseo/bridge-self-check.test.ts`
- Updated file: `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts`

## Outcome

- Runtime self-check location: `bridge-self-check.ts`
- New tests added: 6
- Fail-fast behavior confirmed: bridge self-check failure completes the run immediately with `status: failed`, `summary: bridge_unavailable: <reason>`, zero accepted mutations, and no wasted wakeups
