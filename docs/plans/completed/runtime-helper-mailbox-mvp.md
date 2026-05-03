# Plan: Runtime helper mailbox MVP

## Status

Status: Completed

## Goal

Ship the smallest opt-in runtime-helper path where helper-authored mailbox control messages can drive the full happy-path hello-team run over the existing mailbox transport, while leaving the default path unchanged.

## Scope delivered

- Opt-in `PLUTO_RUNTIME_HELPER_MVP=1` mode for manager runs.
- Workspace-local helper command materialization under `.pluto-runtime/roles/<role>/pluto-mailbox`.
- Helper-backed lead `tasks` / `spawn`, worker `complete`, evaluator `verdict`, and lead `finalize` flow.
- Prompt/runtime wiring that disables synthetic happy-path dispatch only in the opt-in helper mode.
- Focused test coverage and a bounded hello-team end-to-end verification run.

## Verification evidence

- `pnpm typecheck` — pass.
- `pnpm test tests/orchestrator/teamlead-driven-dispatch.test.ts -- --reporter verbose -t "lets lead and workers author the mailbox chain through the runtime helper MVP"` — pass.
- `pnpm test tests/four-layer-loader-render.test.ts` — pass.
- `PLUTO_DISPATCH_MODE=teamlead_chat PLUTO_RUNTIME_HELPER_MVP=1 pnpm exec tsx --eval "..."` — pass; run id `runtime-helper-verify`, status `succeeded`.
- Run evidence:
  - helper materialization recorded in `.tmp/runtime-helper-verify-data/runs/runtime-helper-verify/workspace-materialization.json`
  - helper usage chain recorded in `.tmp/runtime-helper-verify-data/runs/runtime-helper-verify/runtime-helper-usage.jsonl`
  - helper-authored mailbox/event chain recorded in `.tmp/runtime-helper-verify-data/runs/runtime-helper-verify/mailbox.jsonl` and `events.jsonl`

## Notes

- Default `teamlead_chat` behavior stays unchanged when `PLUTO_RUNTIME_HELPER_MVP` is absent.
- Validation intentionally stayed on the minimal fake-adapter `hello-team` path only.

## Follow-up

- Deferred: no broader live/Paseo runtime coverage in this MVP pass.
- Deferred: no generalized helper RPC surface beyond the mailbox/task commands needed for the happy path.
