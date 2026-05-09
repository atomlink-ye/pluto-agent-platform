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

- The self-check now runs only on an actor's first spawn path. Successful results are cached per non-manager actor key so a later re-spawn can reuse the passed probe without re-running it, while actors that are never spawned are never probed.
- The manager-synthesized failure path uses the existing `buildCompleteRunRequest()` authority path, so cleanup and evidence assembly stay unchanged.
- The runtime trace includes `actor`, `attemptedAt`, `reason`, `stderr`, and `latencyMs`.

## Gates

- `pnpm install`: passed via `commands.sh bootstrap`
- `pnpm --filter @pluto/v2-runtime typecheck`: passed
- `pnpm exec tsc -p tsconfig.json --noEmit`: passed
- `pnpm --filter @pluto/v2-runtime test`: failed, `189 passed | 2 failed | 2 skipped (193)`; the remaining failures are the parked-wait regressions in `agentic-tool-loop.test.ts` and `task-closeout.test.ts`
- `pnpm test`: passed, `37 passed (37)`
- `gate_no_kernel_mutation`: passed
- `gate_no_predecessor_mutation`: passed
- `gate_diff_hygiene`: passed
- `gate_no_verbatim_payload_prompts`: passed on the T6-S3 fix-up diff allowlist

## Diff Hygiene

- Branch diff is limited to the allowed runtime adapter/test/report files for T6-S3.
- `pnpm-lock.yaml` was modified by bootstrap in the worktree but was not included in the T6-S3 branch diff.

## Test Additions

- New file: `packages/pluto-v2-runtime/__tests__/adapters/paseo/bridge-self-check.test.ts`
- Updated file: `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts`

## Outcome

- Runtime self-check location: `bridge-self-check.ts`
- New tests added: 7
- Fail-fast behavior confirmed: bridge self-check failure completes the run immediately with `status: failed`, `summary: bridge_unavailable: <reason>`, zero accepted mutations, and no wasted wakeups

## Fix-up commit

- Objection 1 (High): moved bridge preparation + self-check into the `session == null` first-spawn path in `run-paseo.ts`; the cache is now read before any re-spawn probe and written only after a successful self-check, so unused actors no longer abort the run.
- Objection 2 (Medium): reverted the out-of-scope `waitRegistry.hasArmedWait(next.actor)`, `leaseStore.setCurrent(next.actor)`, and `setImmediate(...)` hunks; the self-check failure path still exits through the existing manager-synthesized `complete_run` flow.
- Objection 3 (Medium): added one `bridge-self-check.test.ts` case covering an uncategorized `spawnSync` error and asserting `reason: 'other'`.
