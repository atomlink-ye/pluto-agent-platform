# docs/testing-and-evals.md — Tests vs Evals Split

## Tests vs Evals

| Category | Location | Purpose |
|----------|----------|---------|
| `tests/` | `tests/*.test.ts` | correctness and file-backed runtime behavior |
| `evals/` | `evals/*` | model/workflow quality |

## Main test lanes

- `tests/manager-run-harness.test.ts` — end-to-end fake run through mailbox/task runtime
- `tests/orchestrator/plan-approval-round-trip.test.ts` — proves request -> deliver -> response -> deliver goes through transport plus the inbox loop
- `tests/orchestrator/teamlead-driven-dispatch.test.ts` — happy path, dependsOn rejection, trusted-sender checks, and static fallback coverage for TeamLead-message-driven dispatch
- `tests/four-layer/inbox-delivery-loop.test.ts` — idle delivery, busy queue + drain, failed delivery, wait-timeout loop behavior
- `tests/four-layer-audit.test.ts` — mailbox/task/evidence audit behavior
- `tests/paseo-opencode-adapter.test.ts` — live-adapter boundary behavior
- `tests/cli/run.test.ts` / `tests/cli/runs*.test.ts` — CLI behavior

## Canonical commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:fake
pnpm pluto:run --scenario hello-team --run-profile fake-smoke --workspace .tmp/pluto-cli
pnpm verify
pnpm smoke:local
PASEO_HOST=localhost:6767 pnpm smoke:live
```

## Live-smoke knobs

See `docs/harness.md` for the canonical live-smoke knob table.

## Stage D checks

- Targeted validation for TeamLead-message-driven dispatch can use:

```bash
pnpm vitest --run tests/orchestrator/teamlead-driven-dispatch.test.ts tests/orchestrator/plan-approval-round-trip.test.ts tests/orchestrator/harness-chat-room.test.ts tests/four-layer/inbox-delivery-loop.test.ts tests/live-smoke-classification.test.ts
```

- `docker/live-smoke.ts` now asserts the chat-driven dispatch path by checking `spawn_request_received`, `spawn_request_executed`, `worker_complete_received`, and `final_reconciliation_received` plus `orchestrationSource: "teamlead_chat"` in `events.jsonl`.
