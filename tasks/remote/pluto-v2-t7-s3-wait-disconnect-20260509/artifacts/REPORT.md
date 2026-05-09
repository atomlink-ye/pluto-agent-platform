# T7-S3 Report

## Scope

- Authority plan: `docs/plans/active/v2-craft-fidelity-and-telemetry.md` T7-S3
- Predecessor: `c46885c` (T7-S2)
- Chosen option: `C`

## Investigation Findings

1. The local wait HTTP route cancels parked waits only when the HTTP request/response/socket closes.
   - `packages/pluto-v2-runtime/src/api/pluto-local-api.ts` arms the wait, then registers `request.aborted`, `request.close`, `response.close`, and `socket.close` handlers that call `waitService.registry.cancelForActor(...)`.
   - The registry itself is not treating these as fatal; it resolves `{ outcome: 'cancelled', reason }` and the lead can immediately re-arm.

2. The immutable `pluto-tool wait` client does not install its own `AbortSignal` or explicit timeout.
   - `packages/pluto-v2-runtime/src/cli/pluto-tool.ts` issues a plain `fetch()` to `/tools/wait-for-event` and waits for the response.
   - That makes the observed `http_disconnect` noise consistent with a client/transport idle boundary outside the wait registry's normal event path, not with a kernel abort or task failure.

3. There is no Pluto-side wait-registry timeout bug to fix in the core wait path.
   - The registry timeout is the requested long-poll timeout.
   - The local API server does not introduce an additional wait-specific shutdown path beyond explicit run shutdown.
   - The healthy runs described in POST-T6 recovered because the lead simply re-issued `wait` after the client-side disconnect.

4. The operator-facing problem is classification, not run correctness.
   - `final-report-builder.ts` previously treated every `wait_cancelled` trace as failure-class and surfaced it in `## Diagnostics`.
   - That made benign wait re-arms look similar to real abort-class cancellations like `run_shutdown`.

## Change Summary

1. The live Paseo runtime now labels local-API wait disconnects as `client_idle_disconnect`.
   - File: `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
   - Change: the local API wait service is configured with `disconnectReason: 'client_idle_disconnect'`.

2. Final report diagnostics now treat `client_idle_disconnect` as benign.
   - File: `packages/pluto-v2-runtime/src/evidence/final-report-builder.ts`
   - Change: `wait_cancelled` traces with reason `client_idle_disconnect` are excluded from failure diagnostics.

3. Tests cover both the route behavior and the benign classification.
   - `packages/pluto-v2-runtime/__tests__/api/pluto-local-api.wait.test.ts`
   - `packages/pluto-v2-runtime/__tests__/evidence/final-report-builder.test.ts`
   - `packages/pluto-v2-runtime/__tests__/scripts/smoke-acceptance.test.ts`

## Validation

- `pnpm install` ✅
- `pnpm --filter @pluto/v2-runtime test` ✅ (`215 passed, 2 skipped`)
- `pnpm test` ✅ (`37 passed`)
- `pnpm --filter @pluto/v2-runtime typecheck` ⚠️ fails with pre-existing workspace/core errors, including missing `zod` resolution from `packages/pluto-v2-core/src/**`; no new T7-S3-specific typecheck errors were introduced by the touched files.
- `pnpm exec tsc -p tsconfig.json --noEmit` ⚠️ fails with the same pre-existing baseline errors.

## Notes

- I intentionally did not change `packages/pluto-v2-runtime/src/cli/pluto-tool.ts` or any `v2-core` files.
- I intentionally did not change the MCP wait transport. T7-S3 targeted the live local-API `pluto-tool wait` path that produced the POST-T6 evidence noise.
