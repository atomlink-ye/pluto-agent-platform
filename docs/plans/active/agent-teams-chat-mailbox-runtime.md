# Plan: Agent teams chat mailbox runtime

## Goal

Implement Stage E structured control-plane messages on top of the S4 chat-driven dispatch path: add typed evaluator/revision envelopes, tighten shutdown semantics, consolidate mailbox type guards, and preserve all prior mailbox/task-list invariants.

## Scope

- Add typed `evaluator_verdict` and `revision_request` mailbox message bodies.
- Tighten `shutdown_request` and `shutdown_response` body contracts and route them through harness-side ACK tracking against active sessions only.
- Consolidate mailbox message type guards in `src/four-layer/message-guards.ts` and migrate the harness routing path to use them.
- Extend the `onDelivered` switch with `evaluator_verdict`, `revision_request`, `shutdown_request`, and `shutdown_response` handling while preserving the S4 `spawn_request` flow and `PLUTO_DISPATCH_MODE` fallback.
- Update tests, live smoke, prompt collars, docs, and plan records for the new control-plane evidence.

## Status

Status: In progress

## Tasks

1. Land the Stage E contract updates: new mailbox envelopes, tightened shutdown bodies, new event vocabulary, and the consolidated guard module.
2. Extend harness routing for evaluator verdicts and revision requests, with `revision_request` synthesizing a new `spawn_request` path instead of direct text re-engage.
3. Add shutdown ACK tracking against active role sessions and explicitly resolve `finalReconciliationPromise` on shutdown completion.
4. Add targeted regression coverage, live-smoke assertions, and docs for the structured control-plane path.
5. Run R7-scoped targeted validation during fix passes, then the one-time final gates, collect live evidence, and write the sandbox final report.

## Dependencies

- S5 bundle: `/workspace/tasks/remote/agent-teams-chat-mailbox-s5/spec.md`
- Base branch: `daytona/s4-final` (`ffbb52f`)
- Capability gates: `paseo chat wait`, `paseo send --no-wait`

## Notes

- Lane DAG: `(1) -> {(2),(3)} -> (4)`.
- The inbox delivery loop remains the single transport-backed control plane; Stage E only extends typed envelope handling and evidence emission around that loop.
- `revision_request` must synthesize a new task and route through the existing `spawn_request` handler so revision work still emits `worker_complete`.
- Shutdown fan-out targets active sessions only and must emit `shutdown_complete` after acknowledgments or timeout while resolving `finalReconciliationPromise` exactly once.
- R7 applies to every test/smoke invocation: targeted-only during fix passes, then one final `pnpm test`, one `pnpm smoke:fake`, and one `pnpm smoke:live` at slice end.
