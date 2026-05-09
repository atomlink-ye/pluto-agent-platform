# T10-S1 Report

## Summary
T10-S1 fixes the remaining POST-T9 PARTIAL failure at the driver layer. `client_idle_disconnect` wait cancellations are now absorbed inside the Paseo driver when the actor is still in the `waiting` turn state, so the parked wait is silently re-armed instead of surfacing the disconnect back to the actor.

The implementation keeps the closed kernel unchanged, preserves the existing wait-registry API, and adds only driver-local diagnostics. When a later event arrives, the actor wakes with the event payload directly, so the lead path stays `mutation -> (silent disconnect + re-arm)* -> event` with no `read-state` polling inserted between the mutation and the wake event.

## What changed
- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`: wrapped the wait registry inside the driver so `client_idle_disconnect` cancellations can be classified and silently retried while the actor remains `waiting`; added driver-only `wait_silent_rearm` and `wait_rearm_exhausted` traces; reset the per-actor disconnect counter on actual event delivery; filtered the new driver-only traces out of evidence-packet assembly; added narrow test hooks so the disconnect path can be exercised deterministically.
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts`: added one-disconnect and three-disconnect end-to-end driver tests that force `client_idle_disconnect` cancellations, verify the wake prompt contains only the eventual event payload, and assert that no `pluto_read_state` call appears between the mutation and the event.
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/turn-state.test.ts`: added a cap test covering five consecutive `client_idle_disconnect` cancellations with no event, asserting `wait_rearm_exhausted` and the surfaced cancellation backstop.

## Decisions made
- **Cap value (`MAX_SILENT_REARM_ATTEMPTS`)**: chose `5` because the task contract explicitly set `5` as the default safety backstop and no broader configurability was needed for this slice.
- **Cap fallback behavior**: chose `surface to actor` by returning a non-benign cancellation reason (`wait_rearm_exhausted`) because the prompt explicitly allowed the old actor-visible fallback as the last-resort backstop.
- **`disconnectRearmCount` reset point**: chose `on event delivery` because the requirement was "consecutive disconnects without events"; once a real event unblocks the wait, the disconnect streak is over.
- **Re-arm location**: chose a driver-owned wait-registry wrapper in `run-paseo.ts` instead of changing the shared wait registry or local API route because it keeps the fix in the requested file, preserves the existing API surface, and avoids widening the T9 predecessor blast radius.
- **Trace visibility**: kept `wait_silent_rearm` and `wait_rearm_exhausted` in runtime traces only and excluded them from evidence-packet serialization because the prompt required driver-only diagnostics and no `RunEvent` expansion.
- **Test seam**: added optional runtime-trace and wait-control hooks on `runPaseo` only for deterministic test orchestration because transport-level disconnect timing would have been too flaky for the new unit coverage.

## Approaches considered and rejected
- **Option B (prompt-level "do NOT poll")**: considered and rejected because the task explicitly asked for the structural driver-layer fix first, and the driver wrapper solved the issue without touching prompt-builder predecessors.
- **Changing `packages/pluto-v2-runtime/src/api/pluto-local-api.ts` directly**: rejected because the slice allowlist pointed at `run-paseo.ts`, and the driver wrapper was enough to intercept the benign cancel outcome without expanding the predecessor diff.
- **Changing `packages/pluto-v2-runtime/src/api/wait-registry.ts` semantics globally**: rejected because the shared registry does not own actor turn-state policy; keeping the retry policy in the driver avoided coupling registry behavior to Paseo-specific turn-state rules.
- **Expanding the kernel or `RunEvent` set**: rejected because the prompt and repo rules kept the closed kernel byte-immutable.

## Stop conditions hit
- none

## Gates
- `gate-bootstrap.txt`: pass (`pnpm install --force`, exit `0`). Bootstrap noise still touched `pnpm-lock.yaml`, `packages/pluto-v2-core/package.json`, and regenerated `packages/pluto-v2-core/index.js`; none are staged for commit.
- `gate-build-v2-core.txt`: pass (`pnpm --filter @pluto/v2-core build`, exit `0`, duration `11s`).
- `gate-typecheck-runtime-src.txt`: pass (`pnpm --filter @pluto/v2-runtime typecheck:src`, exit `0`, duration `12s`).
- `gate-typecheck-runtime-test.txt`: pass (`pnpm --filter @pluto/v2-runtime typecheck:test`, exit `0`, duration `13s`).
- `gate-typecheck-root.txt`: pass (`pnpm exec tsc -p tsconfig.json --noEmit`, exit `0`, duration `10s`).
- `gate-test-runtime.txt`: pass (`pnpm --filter @pluto/v2-runtime test`, exit `0`, `247` passed / `249` total, `2` skipped, duration `17s`).
- `gate-test-root.txt`: pass (`pnpm test`, exit `0`, `37` passed / `37` total, duration `34s`).
- `gate-no-kernel-mutation.txt`: pass.
- `gate-no-predecessor-mutation.txt`: pass.
- `gate-no-verbatim-payload-prompts.txt`: pass.
- `gate-diff-hygiene.txt`: pass when run before commits; rerun after the requested commits is still required to validate `main..HEAD` on committed diff.

## Verdict
```text
T10-S1 COMPLETE
silent-rearm-on-disconnect: yes
cap-value: 5
cap-fallback: surface
new tests: 3
typecheck-new-errors: 0
runtime-tests: 247/249
root-tests: 37/37
implementation-commit-sha: c3a0333
report-commit-sha: pending-this-report-commit
push: pending
stop-condition-hit: none
```
