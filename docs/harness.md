# docs/harness.md — Repo as Control Surface

## What the harness provides

| Surface | Purpose |
|---------|---------|
| `AGENTS.md` | repo entry point |
| `docs/mvp-alpha.md` | contract reference |
| `src/orchestrator/manager-run-harness.ts` | main runtime |
| `src/four-layer/` | mailbox/task/hooks/plan-approval primitives |
| `docker/live-smoke.ts` | smoke assertions |
| `scripts/verify.mjs` | fast verification |

## Generated evidence surfaces

- `.pluto/runs/<runId>/mailbox.jsonl`
- `Run.coordinationChannel.locator` / `EvidencePacket.coordinationChannel.locator` record the real shared-channel room id for the run
- Each `mailbox.jsonl` line bakes transport metadata at append time: `transportMessageId`, `transportTimestamp`, `transportStatus`
- Mailbox entries also carry additive delivery metadata at append time when known: `deliveryStatus`, `deliveryAttemptedAt`, `deliveryFailedReason`
- `.pluto/runs/<runId>/events.jsonl` records the delivery loop evidence chain: `mailbox_message`, `mailbox_message_delivered`, `mailbox_message_queued`, `mailbox_message_failed`, `plan_approval_requested`, `plan_approval_responded`, `spawn_request_received`, `spawn_request_executed`, `spawn_request_rejected`, `worker_complete_received`, `final_reconciliation_received`, `evaluator_verdict_received`, `revision_request_received`, `revision_request_dispatched`, `shutdown_request_received`, `shutdown_request_dispatched`, `shutdown_response_received`, and `shutdown_complete`
- `.pluto/runs/<runId>/tasks.json`
- `.pluto/runs/<runId>/artifact.md`
- `.pluto/runs/<runId>/evidence-packet.md`
- `.pluto/runs/<runId>/evidence-packet.json`

## Delivery loop

- One inbox delivery loop runs per manager harness run after the shared room and lead session exist.
- The loop waits on `MailboxTransport.wait()`, resolves role-to-session ids, delivers with `sendSessionMessage({ wait: false })`, queues when a session is busy, and marks inbox entries read after delivery or durable queueing.
- Non-agent targets such as `pluto` and `broadcast` stay mirrored in `mailbox.jsonl` but are skipped cleanly by the delivery loop.
- The planner plan-approval request and the lead response now travel through the shared room and leave delivery evidence in both `mailbox.jsonl` and `events.jsonl`.
- In the default `PLUTO_DISPATCH_MODE=teamlead_chat` path, the same loop also consumes `spawn_request`, `worker_complete`, `final_reconciliation`, `evaluator_verdict`, and `revision_request` envelopes addressed to the lead.
- `revision_request` does not directly re-engage a worker by free text; the harness creates a new task variant and synthesizes a `spawn_request` so the revision still produces `worker_complete` evidence.
- `shutdown_request` fan-out targets only currently active teammate sessions, and `shutdown_complete` resolves the run's final reconciliation path even when no normal `final_reconciliation` follows.

## Runtime control knobs

| Knob | Env Var | Default | Purpose |
|------|---------|---------|---------|
| Adapter | `PLUTO_LIVE_ADAPTER` | `paseo-opencode` | fake or live adapter |
| Fake alias | `PLUTO_FAKE_LIVE` | off | alias for fake adapter |
| Provider | `PASEO_PROVIDER` | `opencode` | paseo provider alias |
| Model | `PASEO_MODEL` | `opencode/minimax-m2.5-free` | model id |
| Mode | `PASEO_MODE` | `orchestrator` | paseo launch mode |
| Host | `PASEO_HOST` | local socket | explicit paseo daemon host |
| Dispatch mode | `PLUTO_DISPATCH_MODE` | `teamlead_chat` | chat-driven dispatch or legacy static fallback |
| Binary | `PASEO_BIN` | `paseo` | paseo CLI path |
| Scenario | `PLUTO_SCENARIO` | `hello-team` | scenario selection |
| Run profile | `PLUTO_RUN_PROFILE` | `fake-smoke` | run-profile selection |
| Playbook | `PLUTO_PLAYBOOK` | scenario default | playbook override |
| Workspace | `PLUTO_LIVE_WORKSPACE` | auto | live workspace override |
| OpenCode debug | `OPENCODE_BASE_URL` | unset | optional debug endpoint |

## CLI surfaces

- `pnpm pluto:run --scenario <name> --run-profile <name> [--workspace <path>]`
- `pnpm runs list/show/events/artifact/evidence`
- `pnpm smoke:fake`
- `pnpm smoke:local`
- `pnpm smoke:live`
- `pnpm verify`
