# T14-S4 REPORT

## Summary

Added a shared `describeRuntimeAdapterContract()` helper plus new Fake and Paseo contract tests under `packages/pluto-v2-runtime/__tests__/adapters/`.

After rebasing onto `origin/main` at `5967cea2`, the slice-relevant gates are green:
- build of core + runtime CLI bridge
- `@pluto/v2-runtime` typecheck
- shared targeted contract suite for Fake + Paseo
- full `@pluto/v2-runtime` test suite

The repo-wide `pnpm test` artifact still has failures, but they are confined to the known root `tests/cli/run*.test.ts` bucket that this final-round prompt explicitly called out as out-of-scope POST-T14.

## Files changed

- `packages/pluto-v2-runtime/__tests__/adapters/contract/runtime-adapter-contract.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/fake/fake-adapter.contract.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/paseo-adapter.contract.test.ts`

## Decisions made

- Contract properties chosen:
  - `init()` must return a stable initial state for the same team context and kernel view.
  - `step()` must preserve a deterministic transport shape for the same primed state + view. The assertion intentionally ignores generated `requestId` because both current adapters close over mutable ID providers.
  - Happy path must emit one or more request steps before a terminal `done` with `succeeded` status.
  - Adapter state must progress monotonically toward termination via adapter-specific cursors (`FakeAdapterState.index`, `PaseoAdapterState.turnIndex`).
  - Terminal completions must surface the public `RunCompletedStatus` values `succeeded`, `failed`, and `cancelled` without coercion.
  - Exhaustion must classify as `failed` rather than `succeeded`.
- Paseo deterministic stub source:
  - Used the existing deterministic adapter surface (`pendingPaseoTurn()` + `withPaseoResponse()`) instead of a subprocess.
  - The stubbed transcripts mirror the deterministic directive flow already exercised in `paseo-adapter.test.ts` and the larger mocked Paseo loop tests.
- Properties skipped:
  - None.
- `runtime-adapter.ts` extension:
  - None. The existing interface was sufficient; Paseo-specific turn priming stayed in test-only harness hooks.

## Approaches considered and rejected

- Extending `RuntimeAdapter` with new contract-only hooks.
  - Rejected because the current public interface plus test harness priming was sufficient.
- Asserting full `step()` object equality including `requestId`.
  - Rejected because both adapters generate IDs through injected mutable providers, so exact `requestId` equality is not a stable contract invariant.
- Driving Paseo through a real subprocess or the full CLI client in the contract suite.
  - Rejected per slice scope. The contract suite stays deterministic and in-process.

## Gates / evidence

| Gate | Artifact | Started | Duration | Exit |
|---|---|---|---|---|
| bootstrap | `/workspace/tasks/remote/v2-open-role-mvp-s4/artifacts/gate-bootstrap.txt` | 2026-05-10T14:48:20+00:00 | 3s | 0 |
| build runtime cli | `/workspace/tasks/remote/v2-open-role-mvp-s4/artifacts/gate-build.txt` | 2026-05-10T14:49:17+00:00 | 17s | 0 |
| runtime typecheck | `/workspace/tasks/remote/v2-open-role-mvp-s4/artifacts/gate-typecheck.txt` | 2026-05-10T14:49:43+00:00 | 18s | 0 |
| runtime targeted | `/workspace/tasks/remote/v2-open-role-mvp-s4/artifacts/gate-runtime-targeted.txt` | 2026-05-10T14:50:02+00:00 | 5s | 0 |
| runtime tests | `/workspace/tasks/remote/v2-open-role-mvp-s4/artifacts/gate-runtime-tests.txt` | 2026-05-10T14:50:07+00:00 | 20s | 0 |
| full tests | `/workspace/tasks/remote/v2-open-role-mvp-s4/artifacts/gate-full-tests.txt` | 2026-05-10T14:50:27+00:00 | 17s | 1 |

Notes:
- `gate-runtime-targeted.txt` is green and covers the new shared contract suite for Fake + Paseo.
- `gate-runtime-tests.txt` is green after rebasing onto the upstream authority/zod/paseo-fix stack.
- `gate-full-tests.txt` still fails only in root CLI coverage under `tests/cli/run-exit-code-2-v2.test.ts`, `tests/cli/run-unsupported-scenario.test.ts`, `tests/cli/run-runtime-precedence.test.ts`, and `tests/cli/run-runtime-v2-default.test.ts`.
- Per the final-round prompt, that remaining root CLI rot is documented out-of-scope POST-T14 and does not block this slice.

## Stop conditions hit

- None for the slice scope.

## Verdict

- Implementation commit: `6940f6c3f490c0f3cbfbf02fdc13afb2101c22a1`
- Report commit: pending
- Branch: `pluto/v2/open-role-mvp-s4-adapter-contract`
- Acceptance checklist: `PASS`
  - Shared `describeRuntimeAdapterContract()` helper exists.
  - Fake and Paseo both pass the shared contract suite.
  - No `packages/pluto-v2-core/src/*` files or existing adapter implementations were edited.
  - Slice-relevant build, typecheck, targeted, and runtime test gates are green on the rebased upstream state.
