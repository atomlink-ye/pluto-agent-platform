# MVP-alpha QA Checklist

Run after every meaningful change.

## 1. Static gates

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm verify`
- [ ] `pnpm verify` runs `pnpm spec:hygiene` in the default non-required mirror mode, so verify still passes when the production mirror is absent.
- [ ] Local authors can point the hygiene check at a mirror with `pnpm spec:hygiene --input <path-to-mirror>`.

## 2. Fake adapter E2E

- [ ] `pnpm pluto:run --scenario hello-team --run-profile fake-smoke --workspace .tmp/pluto-cli`
- [ ] `.pluto/runs/<runId>/mailbox.jsonl` exists
- [ ] `.pluto/runs/<runId>/events.jsonl` shows at least one `mailbox_message_delivered` event
- [ ] `.pluto/runs/<runId>/tasks.json` exists
- [ ] planner, generator, evaluator tasks complete in dependency order
- [ ] `.pluto/runs/<runId>/evidence-packet.json` exists and validates

## 3. Live smoke

- [ ] `pnpm smoke:local` returns `status: ok` or an allowed structured blocker/partial per current policy
- [ ] `PASEO_HOST=<host> pnpm smoke:live` behaves the same when using an explicit daemon
- [ ] `mailbox.jsonl` contains team coordination, teammate completion, FINAL summary, and plan-approval messages when applicable
- [ ] `events.jsonl` contains a delivery event chain plus `plan_approval_requested`, `plan_approval_responded`, `spawn_request_received`, `spawn_request_executed`, `worker_complete_received`, and `final_reconciliation_received`
- [ ] `tasks.json` contains pending → in_progress → completed transitions
- [ ] `artifact.md` references lead, planner, generator, evaluator
- [ ] `evidence-packet.json` cites mailbox/task lineage and role citations

## 4. Documentation

- [ ] README quickstart matches the current `pnpm pluto:run` path
- [ ] `docs/mvp-alpha.md` matches current four-layer/runtime contracts
- [ ] `docs/harness.md` knob table matches `docker/live-smoke.ts`
- [ ] `PLUTO_DISPATCH_MODE` documentation matches the default `teamlead_chat` path and `static_loop` fallback
- [ ] Repository-documentation consistency check passes
