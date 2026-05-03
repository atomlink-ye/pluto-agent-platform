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

## Gate wrapper

- Use `node scripts/gate.mjs <gate-name> -- <command>` for recorded verification gates.
- The wrapper writes timing headers directly into the gate artifact stream:

```text
# started: 2026-05-03T11:45:06Z
# command: pnpm test
# duration: 127.95s
# exit: 0
```

- Slice-end artifacts should preserve those headers verbatim so later reviews can reconstruct the timeline without parsing agent logs.

## Live-smoke knobs

See `docs/harness.md` for the canonical live-smoke knob table.

## Stage D checks

- Targeted validation for TeamLead-message-driven dispatch can use:

```bash
pnpm vitest --run tests/orchestrator/teamlead-driven-dispatch.test.ts tests/orchestrator/plan-approval-round-trip.test.ts tests/orchestrator/harness-chat-room.test.ts tests/four-layer/inbox-delivery-loop.test.ts tests/live-smoke-classification.test.ts
```

- `docker/live-smoke.ts` now asserts the chat-driven dispatch path by checking `spawn_request_received`, `spawn_request_executed`, `worker_complete_received`, and `final_reconciliation_received` plus `orchestrationSource: "teamlead_chat"` in `events.jsonl`.

## Live-smoke fixture replay

- When a live `pnpm smoke:live` run hits a parser/format/handler issue, capture the run directory under `tests/fixtures/live-smoke/<runId>/` instead of rerunning live.
- Use `tests/fixtures/live-smoke/_helpers.ts` to load fixture `events.jsonl`, `mailbox.jsonl`, and adjacent JSON artifacts in replay tests.
- Keep replay tests short and focused: load the fixture, inject the failing worker output into the fake adapter path, and assert the repaired control-plane behavior.
