# Plan: Agent teams chat mailbox runtime

## Goal

Implement Stage C inbox delivery / wakeup loop on top of the S2 shared-chat mailbox transport so transport-posted messages wake the target session and the plan-approval round-trip flows through the real transport.

## Scope

- Add the Stage C transport `wait()` contract and delivery telemetry.
- Implement live and fake transport `wait()` behavior.
- Add adapter session/role message delivery APIs and role-to-session lookup.
- Add the inbox delivery loop, remove the harness plan-approval shortcut, extend tests, and update runtime docs/live smoke assertions.
- Preserve S2 invariants: append-only `mailbox.jsonl`, provider neutrality outside `src/adapters/paseo-opencode/`, no new run-status values.

## Status

Status: In progress

## Tasks

1. Land lane 1 contract changes for transport `wait()`, mailbox delivery metadata, and delivery event kinds.
2. Land lanes 2-4 for live/fake transport wait behavior and adapter session-message delivery.
3. Fix any contract strictness drift found during leaf review before integration.
4. Implement lane 5 inbox delivery loop, harness rewire, regression tests, live-smoke coverage, and doc updates.
5. Run Stage C gates and capture live evidence plus a final sandbox report.

## Dependencies

- S3 bundle: `/workspace/tasks/remote/agent-teams-chat-mailbox-s3/spec.md`
- Base branch: `daytona/s2-final` (`2974439`)
- Capability gates: `paseo chat wait`, `paseo send --no-wait`, `paseo send --prompt-file`

## Notes

- Lane DAG: `1 -> {2,3,4} -> 5`.
- Lane 5 implementation now owns one inbox delivery loop per run, drives planner plan approval through shared transport, and records delivery telemetry in `events.jsonl`.
- Fake-adapter happy-path delivery keeps sessions effectively idle after non-blocking deliveries so the harness can deliver multiple messages, while explicit test-controlled idle toggles still drive the queue tests.
- Follow-up verification target: `pnpm typecheck` plus `pnpm vitest --run tests/four-layer/inbox-delivery-loop.test.ts tests/orchestrator/plan-approval-round-trip.test.ts tests/orchestrator/harness-chat-room.test.ts tests/four-layer/mailbox-transport.test.ts tests/live-smoke-classification.test.ts`.
