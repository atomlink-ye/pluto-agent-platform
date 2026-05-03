# Pluto MVP-alpha — Object & Contract Reference

## Goal

Prove the smallest closed loop where Pluto loads authored `Agent`, `Playbook`,
`Scenario`, and `RunProfile`, runs the v1.6 mailbox/task-list runtime, and emits
audit-grade evidence.

## Mainline runtime

- Entrypoint: `src/orchestrator/manager-run-harness.ts`
- CLI: `src/cli/run.ts` (`pnpm pluto:run ...`)
- Main evidence: `.pluto/runs/<runId>/evidence-packet.{md,json}`
- Runtime primitives: mailbox, task list, hooks, plan approval, TeamLead-driven dispatch envelopes, structured verdict/revision/shutdown control messages

## Objects

| Object | Where it lives | Notes |
| --- | --- | --- |
| `Agent` | `agents/*.yaml` | authored role/system/model definition |
| `Playbook` | `playbooks/*.yaml` | team composition + workflow + audit policy |
| `Scenario` | `scenarios/*.yaml` | task specialization and overlays |
| `RunProfile` | `run-profiles/*.yaml` | workspace + acceptance + artifact/stdout policy |
| `MailboxMessage` | `mailbox.jsonl` / `src/contracts/four-layer.ts` | typed coordination message with baked transport and additive delivery metadata |
| `Task` | `tasks.json` / `src/contracts/four-layer.ts` | shared task-list record |
| `Run` | `.pluto/runs/<runId>/` | materialized runtime record |
| `RunPackage` | `src/four-layer/run-package.ts` (compiled in-memory; inspectable via `pnpm pluto:package`) | normalized compiled output of Agent + Playbook + Scenario + RunProfile; the object handed to the runtime executor |
| `EvidencePacket` | `.pluto/runs/<runId>/evidence-packet.{md,json}` | canonical evidence |

## Adapter contract

`PaseoTeamAdapter` remains the only runtime seam. It bootstraps the run, creates the lead
session, creates worker sessions when asked by the harness/runtime flow, forwards
messages, drains events, waits for completion, tears down runtime state, and accepts
delivery-loop follow-up messages through `sendSessionMessage()`.

## Runtime evidence

Required runtime artifacts:

- `mailbox.jsonl`
- `Run.coordinationChannel.locator` points at the real shared channel room id; `mailbox.jsonl` remains the canonical mirrored transcript
- `events.jsonl` includes delivery telemetry (`mailbox_message_delivered`, `mailbox_message_queued`, `mailbox_message_failed`), the plan-approval round-trip events, the chat-driven dispatch events (`spawn_request_*`, `worker_complete_received`, `final_reconciliation_received`), and the structured control-plane events (`evaluator_verdict_*`, `revision_request_*`, `shutdown_*`)
- `tasks.json`
- `artifact.md`
- `evidence-packet.json`

## Delivery semantics

- The manager harness owns one inbox delivery loop per run.
- The loop waits on `MailboxTransport.wait()`, skips non-agent targets like `pluto` and `broadcast`, resolves role-to-session ids, and delivers ordinary mailbox traffic with `sendSessionMessage({ wait: false })`.
- In `PLUTO_RUNTIME_HELPER_MVP=1`, helper `wait` requests are resolved on Pluto's side from task-state transitions, and already-handled lead control envelopes are recorded as semantic deliveries instead of being replayed back into the lead session.
- If a target session is busy, the loop queues the message per session and drains it after a later just-in-time idle check.
- Planner plan approval is now a real room round-trip: planner posts `plan_approval_request`, the lead response is posted back to the room as `plan_approval_response`, and both deliveries are evidenced through the loop.
- TeamLead-message-driven dispatch is now the default runtime path: the lead posts `spawn_request` and `final_reconciliation` envelopes, Pluto validates them on inbox delivery, and `PLUTO_DISPATCH_MODE=static_loop` keeps the v1.6 fallback for one release.
- Evaluators can post structured `evaluator_verdict` envelopes. When the verdict fails, the lead can post a `revision_request`, and Pluto converts that into a fresh `spawn_request`-backed worker task so the revision remains visible in the task list and mailbox evidence.
- Early shutdown is structured: the lead posts `shutdown_request`, Pluto fans it out to active teammate sessions only, teammates answer with `shutdown_response`, and Pluto emits `shutdown_complete` while resolving finalization even if no later `final_reconciliation` arrives.

## Acceptance

A run is acceptable iff:

1. mailbox/task artifacts exist and reflect the expected task progression;
2. the final artifact exists and references the contributing roles;
3. `evidence-packet.json` exists and records citations plus mailbox/task lineage.
4. the room transcript plus `events.jsonl` show mailbox delivery evidence, the planner plan-approval round-trip, and the chat-driven dispatch/control-plane events when `PLUTO_DISPATCH_MODE=teamlead_chat`.
