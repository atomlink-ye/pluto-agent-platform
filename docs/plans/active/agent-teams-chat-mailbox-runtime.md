# Plan: Agent teams chat mailbox runtime

## Goal

Implement Stage D TeamLead-message-driven dispatch on top of the S3 inbox delivery loop so worker creation is driven by typed mailbox envelopes rather than the harness's static worker for-loop.

## Scope

- Add typed `spawn_request`, `worker_complete`, and `final_reconciliation` mailbox message bodies.
- Rewrite the harness dispatch path around the inbox loop `onDelivered` switch while preserving `plan_approval_request` handling.
- Keep the legacy static worker for-loop behind `PLUTO_DISPATCH_MODE=static_loop` for one release.
- Extend tests, live-smoke coverage, and docs for the new default `teamlead_chat` path.
- Preserve S2/S3 invariants: append-only `mailbox.jsonl`, provider neutrality outside `src/adapters/paseo-opencode/`, no new run-status values, and inbox-loop ownership of transport-backed delivery.

## Status

Status: In progress

## Tasks

1. Land the Stage D contract and event-vocabulary changes for the new mailbox envelopes and dispatch telemetry.
2. Replace the default harness dispatch path with the TeamLead-message-driven inbox-loop control path while preserving the static fallback.
3. Add regression coverage for happy-path dispatch, dependsOn rejection, trusted-sender checks, and fallback mode.
4. Update live smoke and documentation for `PLUTO_DISPATCH_MODE`, `orchestrationSource: "teamlead_chat"`, and the new dispatch evidence.
5. Run Stage D gates and capture live evidence plus a final sandbox report.

## Dependencies

- S4 bundle: `/workspace/tasks/remote/agent-teams-chat-mailbox-s4/spec.md`
- Base branch: `daytona/s3-final` (`3165537`)
- Capability gates: `paseo chat wait`, `paseo send --no-wait`, `paseo send --prompt-file`

## Notes

- Lane DAG: `1 -> {2,3} -> 4`.
- The inbox delivery loop remains the single transport-backed control plane; Stage D only extends its `onDelivered` switch and emitted event vocabulary.
- `PLUTO_DISPATCH_MODE=teamlead_chat` is now the default; `PLUTO_DISPATCH_MODE=static_loop` preserves the old direct worker loop for one release.
- Follow-up verification target: `pnpm typecheck` plus `pnpm vitest --run tests/orchestrator/teamlead-driven-dispatch.test.ts tests/orchestrator/plan-approval-round-trip.test.ts tests/orchestrator/harness-chat-room.test.ts tests/four-layer/inbox-delivery-loop.test.ts tests/live-smoke-classification.test.ts`.
