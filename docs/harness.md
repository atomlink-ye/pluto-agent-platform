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
- When `PLUTO_RUNTIME_HELPER_MVP=1`, Pluto materializes the shared helper at `.pluto-runtime/pluto-mailbox`, injects role/context for live sessions, and records helper invocations in `.pluto/runs/<runId>/runtime-helper-usage.jsonl`
- In the live `paseo-opencode` helper path, `pnpm pluto:run --workspace <dir>` now materializes the actual run cwd under `<dir>/.pluto-run-workspaces/<runId>` so `.pluto-runtime/` helper state stays isolated per run instead of being reused at the workspace root.
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
- In `PLUTO_RUNTIME_HELPER_MVP=1`, helper `wait` is satisfied on Pluto's side from task-state transitions, so the lead can block on `pluto-mailbox wait` instead of polling files or relying on noisy direct session traffic.
- Non-agent targets such as `pluto` and `broadcast` stay mirrored in `mailbox.jsonl` but are skipped cleanly by the delivery loop.
- The planner plan-approval request and the lead response now travel through the shared room and leave delivery evidence in both `mailbox.jsonl` and `events.jsonl`.
- In the default `PLUTO_DISPATCH_MODE=teamlead_chat` path, the same loop also consumes `spawn_request`, `worker_complete`, `final_reconciliation`, `evaluator_verdict`, and `revision_request` envelopes addressed to the lead.
- With `PLUTO_RUNTIME_HELPER_MVP=1`, those core control envelopes can be authored by the lead/workers through Pluto's run-local helper instead of Pluto auto-posting the first/next dispatch steps or worker completion for the happy path.
- When those lead-directed control envelopes are already semantically handled, the runtime records `mailbox_message_delivered` with `deliveryMode: "runtime_helper_semantic"` instead of replaying the same control traffic back into the lead session.
- In helper MVP mode, a role blocked in helper `wait` can be resumed directly from Pluto's semantic task handling path; if no helper wait is active, Pluto may still fall back to direct session delivery.
- Helper-authored lead messages that Pluto already handled semantically are suppressed from redundant lead-session delivery when possible, which cuts busy-period and post-finalize noise in live runs.
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
| Runtime helper MVP | `PLUTO_RUNTIME_HELPER_MVP` | off | materialize the shared helper CLI and require agent-authored core mailbox flow |
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

## Gate artifacts

- Use `node scripts/gate.mjs <gate-name> -- <command>` for acceptance and regression gate captures.
- Each gate artifact should include the wrapper's timing header (`started`, `command`, `duration`, `exit`) ahead of the underlying command output.
- `PLUTO_PLAYBOOK` may override the scenario default playbook for smoke coverage; when it does, scenario overlays for roles that are no longer in the selected playbook are skipped instead of failing the load.
