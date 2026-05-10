# T14-Sx REPORT

## Summary

Updated the stale paseo adapter fixtures to reflect T13-S2's lead close-out enforcement.
The scoped fix swaps lead-side fixture traffic from primitive `complete-run` to composite `final-reconciliation`, updates local test shims to hit `/v2/composite/final-reconciliation`, restores test-only typing after the rebase onto `main` hotfix `2f1495f`, and keeps the runtime gates green on the rebased branch.

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
- Rebase follow-up: after rebasing onto `origin/main` with the zod hotfix, `tsc` surfaced test-only helper issues in the edited fixtures. Fixed by adding the missing `prompt` destructures at the lead close-out call sites and restoring the typed `policy` field on the local `RunState` helper.
- Surgical vs rewrite: surgical. The change stayed inside the existing four fixture files and reused each file's local helpers.
- Notes on T13-S2 behavior: the production behavior change is structural in two places. `agentic-tool-prompt-builder.ts` now teaches lead actors to terminate with `final-reconciliation`, and `pluto-local-api.ts` rejects direct lead `complete-run` with `lead_must_use_final_reconciliation` so the reconciliation evidence file is always written.

## Approaches considered and rejected

- Reverting the T13-S2 route-layer 403: rejected because this slice is fixture-only and the route enforcement is the intended production behavior.
- Editing `__tests__/api/pluto-local-api.test.ts`: rejected because the prompt limited this side-track to `packages/pluto-v2-runtime/__tests__/adapters/paseo/` only.
- Changing runtime source or kernel code to satisfy unrelated gate failures: rejected as out of scope for this slice.

## Gates / evidence

| Gate | Artifact | Started | Duration | Exit |
|---|---|---|---|---|
| `pnpm install --frozen-lockfile=false` | `tasks/remote/v2-open-role-mvp-sx-cascade-rot/artifacts/gate-bootstrap.txt` | 2026-05-10T14:33:01+00:00 | 2s | 0 |
| `pnpm build:runtime-cli` | `tasks/remote/v2-open-role-mvp-sx-cascade-rot/artifacts/gate-build.txt` | 2026-05-10T14:33:03+00:00 | 16s | 0 |
| `pnpm --filter @pluto/v2-runtime typecheck` | `tasks/remote/v2-open-role-mvp-sx-cascade-rot/artifacts/gate-typecheck.txt` | 2026-05-10T14:37:58+00:00 | 20s | 0 |
| Targeted paseo fixtures | `tasks/remote/v2-open-role-mvp-sx-cascade-rot/artifacts/gate-runtime-targeted.txt` | 2026-05-10T14:38:18+00:00 | 13s | 0 |
| `pnpm --filter @pluto/v2-runtime test` | `tasks/remote/v2-open-role-mvp-sx-cascade-rot/artifacts/gate-runtime-tests.txt` | 2026-05-10T14:38:31+00:00 | 13s | 0 |

## Stop conditions hit

- None during the final rebased gate pass.
- Historical note: `tests/cli/run-runtime-v2-default.test.ts:337` remains documented root-suite rot outside this slice and was not re-opened here.

## Verdict

- Implementation commit: `8716f428e6fdd6d637cb539365b88661bfa052e4`
- Report commit: pending at report write time; recorded after `docs(tasks): T14-Sx REPORT`
- Branch: `pluto/v2/open-role-mvp-sx-cascade-rot`
- Acceptance: PASS
