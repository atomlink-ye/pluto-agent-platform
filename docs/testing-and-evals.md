# docs/testing-and-evals.md — Tests vs Evals Split

## Tests vs Evals

| Category | Location | Purpose |
|----------|----------|---------|
| `tests/` | `tests/*.test.ts` | correctness and file-backed runtime behavior |
| `evals/` | `evals/*` | model/workflow quality |

## Main test lanes

- `tests/manager-run-harness.test.ts` — end-to-end fake run through mailbox/task runtime
- `tests/orchestrator/plan-approval-round-trip.test.ts` — proves request -> deliver -> response -> deliver goes through transport plus the inbox loop
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

## Stage C checks

- Targeted validation for the inbox delivery loop and plan-approval wiring can use:

```bash
pnpm vitest --run tests/four-layer/inbox-delivery-loop.test.ts tests/orchestrator/plan-approval-round-trip.test.ts tests/orchestrator/harness-chat-room.test.ts tests/four-layer/mailbox-transport.test.ts tests/live-smoke-classification.test.ts
```

- `docker/live-smoke.ts` now asserts at least one delivery event chain from `events.jsonl` and verifies that the planner plan-approval round-trip is present in both `mailbox.jsonl` and `events.jsonl`.
