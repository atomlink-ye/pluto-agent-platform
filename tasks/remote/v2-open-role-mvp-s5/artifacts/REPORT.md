# T14-S5 REPORT

## Summary

Added a new `poet-critic-open-role` `agentic_tool` fixture plus loader coverage that proves custom roles load, compile, authorize, and slice playbook content cleanly through the shipped T14 runtime path.

Updated `README.md`, `docs/harness.md`, and `docs/mvp-alpha.md` so the public docs describe the open-role MVP honestly: custom non-lead roles are open, `lead` and `manager` stay required, one actor still maps to one `role:<role>` identity, and the T15+ deferrals remain explicit.

## Files changed

- `packages/pluto-v2-runtime/test-fixtures/scenarios/poet-critic-open-role/scenario.yaml`
- `packages/pluto-v2-runtime/test-fixtures/scenarios/poet-critic-open-role/playbook.md`
- `packages/pluto-v2-runtime/__tests__/loader/authored-spec-loader.test.ts`
- `README.md`
- `docs/harness.md`
- `docs/mvp-alpha.md`
- `tests/fixtures/live-smoke/agentic-tool-live-runid.txt`
- `tests/fixtures/live-smoke/run-poet-critic-open-role/`

## Decisions made

- Custom roles chosen: `poet` for the worker-style draft lane and `critic` for the review lane.
- Authored policy shape:
  - `append_mailbox_message`: `manager`, `lead`, `poet`, `critic`
  - `create_task`: `manager`, `lead`
  - `change_task_state`: `manager`, `lead`, `poet`, `critic`
  - `publish_artifact`: `manager`, `lead`, `poet`
  - `complete_run`: `manager`
- Custom-role authorization stays within the current shipped core matcher surface. The fixture uses explicit `role` matchers for `poet` and `critic`, while the runtime still routes worker/review close-out structurally through `worker-complete` and `evaluator-verdict`.
- Tests added: one loader test that loads the new fixture, compiles the normalized agentic shape, asserts `poet`/`critic` policy entries, and verifies positive `change_task_state` plus negative `complete_run` authorization.
- Smoke target chosen: the new `poet-critic-open-role` fixture. Result: PASS, captured at `tests/fixtures/live-smoke/run-poet-critic-open-role/`.
- Plan move decision: deferred. Per the slice prompt, `docs/plans/active/v2-open-role-mvp.md` was not moved in this slice.

## Approaches considered and rejected

- Rejected modifying `packages/pluto-v2-core/` to broaden the custom-role matcher family. The slice prompt forbids kernel changes, and the shipped runtime path already supports the MVP with authored custom-role policy plus existing composites.
- Rejected rewriting README or harness docs wholesale. The requirement was surgical sync, so the edits only extend the active contract descriptions.
- Rejected using the canonical Symphony fixture for the one allowed `smoke:live` run. The new open-role fixture was the highest-value end-to-end proof for this final slice.
- Rejected moving the active plan file. The slice prompt explicitly says to leave the plan in `docs/plans/active/` until POST-T14 validation.

## Gates / evidence

| Gate | Artifact | Started | Duration | Exit |
|---|---|---|---|---|
| bootstrap | `artifacts/gate-bootstrap.txt` | 2026-05-10T15:29:51+00:00 | 2s | 0 |
| build runtime cli | `artifacts/gate-build.txt` | 2026-05-10T15:29:53+00:00 | 9s | 0 |
| typecheck core | `artifacts/gate-typecheck-core.txt` | 2026-05-10T15:30:06+00:00 | 3s | 0 |
| typecheck runtime | `artifacts/gate-typecheck-runtime.txt` | 2026-05-10T15:30:09+00:00 | 19s | 0 |
| test core | `artifacts/gate-core-tests.txt` | 2026-05-10T15:30:33+00:00 | 5s | 0 |
| test runtime | `artifacts/gate-runtime-tests.txt` | 2026-05-10T15:30:42+00:00 | 16s | 0 |
| smoke live | `artifacts/gate-smoke-live.txt` | 2026-05-10T15:31:02+00:00 | 366s | 0 |

Additional targeted validation before the full gates:

- `timeout 1200 pnpm --filter @pluto/v2-runtime exec vitest run __tests__/loader/authored-spec-loader.test.ts`

## Stop conditions hit

- None.

## Verdict

- Implementation commit: 75ef9135e097dd962bafdc4e5dcb7d7cd768ac4c
- Report commit: pending
- Branch: pluto/v2/open-role-mvp-s5-fixture-docs
- Acceptance: PASS
