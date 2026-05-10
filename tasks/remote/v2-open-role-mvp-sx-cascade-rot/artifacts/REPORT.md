# T14-Sx REPORT

## Summary

Updated the stale paseo adapter fixtures to reflect T13-S2's lead close-out enforcement.
The scoped fix swaps lead-side fixture traffic from primitive `complete-run` to composite `final-reconciliation`, updates local test shims to hit `/v2/composite/final-reconciliation`, and loosens one brittle wait-trace assertion that drifted under the new close-out path.

## Files changed (test fixtures only)

- `packages/pluto-v2-runtime/__tests__/adapters/paseo/run-paseo.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/task-closeout.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/turn-state.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts`

## Decisions made

- `run-paseo.test.ts`: the never-active-actor handoff fixture still closed the lead via `/tools/complete-run`, which now 403s for the lead. Fixed by calling `/v2/composite/final-reconciliation` in the mock idle path.
- `task-closeout.test.ts`: lead fixture turns still called `pluto_complete_run`, which caused extra lead wakeups after route-layer rejection. Fixed by teaching the mock client about `pluto_final_reconciliation` and switching the lead scripts to that composite path.
- `turn-state.test.ts`: the trace fixture still modeled lead primitive close-out. Fixed by routing lead close-out through `pluto_final_reconciliation`; the terminal actor-set expectation stayed on the actual trace output after rerun.
- `agentic-tool-loop.test.ts`: the lead close-out fixtures and prompt-count expectations were stale because direct lead `complete-run` now loops back with rejection context. Fixed by updating the helper routing, swapping lead scripts to `pluto_final_reconciliation`, and updating the couple of assertions that now correctly observe failed-audit close-out summaries when the scenario has no real task/mailbox evidence to cite.
- Surgical vs rewrite: surgical. The change stayed inside the existing four fixture files and reused each file's local helpers.
- Notes on T13-S2 behavior: the production behavior change is structural in two places. `agentic-tool-prompt-builder.ts` now teaches lead actors to terminate with `final-reconciliation`, and `pluto-local-api.ts` rejects direct lead `complete-run` with `lead_must_use_final_reconciliation` so the reconciliation evidence file is always written.

## Approaches considered and rejected

- Reverting the T13-S2 route-layer 403: rejected because this slice is fixture-only and the route enforcement is the intended production behavior.
- Editing `__tests__/api/pluto-local-api.test.ts`: rejected because the prompt limited this side-track to `packages/pluto-v2-runtime/__tests__/adapters/paseo/` only.
- Changing runtime source or kernel code to satisfy unrelated gate failures: rejected as out of scope for this slice.

## Gates / evidence

| Gate | Artifact | Started | Duration | Exit |
|---|---|---|---|---|
| `pnpm --filter @pluto/v2-runtime typecheck` | `tasks/remote/v2-open-role-mvp-sx-cascade-rot/artifacts/gate-typecheck.txt` | 2026-05-10T14:22:52+00:00 | 6s | 2 |
| Targeted paseo fixtures | `tasks/remote/v2-open-role-mvp-sx-cascade-rot/artifacts/gate-runtime-targeted.txt` | 2026-05-10T14:26:57+00:00 | 13s | 0 |
| `pnpm --filter @pluto/v2-runtime test` | `tasks/remote/v2-open-role-mvp-sx-cascade-rot/artifacts/gate-runtime-tests.txt` | 2026-05-10T14:26:30+00:00 | 14s | 1 |
| `pnpm test` (root) | `tasks/remote/v2-open-role-mvp-sx-cascade-rot/artifacts/gate-root-tests.txt` | 2026-05-10T14:23:15.732Z | 26s | 1 |

## Stop conditions hit

- `gate_typecheck` is red in existing runtime source files outside this slice's allowed test-only surface.
- `gate_runtime_full` is still red because `packages/pluto-v2-runtime/__tests__/api/pluto-local-api.test.ts:346` still expects lead `/tools/complete-run` to succeed. That test is outside the allowed paseo fixture scope and was already called out as handled elsewhere.
- `pnpm test` (root) is still red on `tests/cli/run-runtime-v2-default.test.ts:337`, which is outside this slice's scope and matches the handoff's deferred CLI-rot warning.

## Verdict

- Implementation commit: `5ae86cd9a6dae1940a11fafd7d9895cef4ab7927`
- Report commit: pending at report write time; recorded in the final reply after `docs(tasks): T14-Sx REPORT`
- Branch: `pluto/v2/open-role-mvp-sx-cascade-rot`
- Acceptance: NEEDS_FIX
