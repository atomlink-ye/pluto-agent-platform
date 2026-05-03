# Plan: Agent teams chat mailbox runtime

## Goal

Close the mailbox-runtime iteration by landing Stage F coverage plus the S1-S5 hardening backlog: add the non-default-role custom playbook smoke and revision-loop smoke, harden the inbox loop and combined-vitest cleanup path, finish the provider-neutral runtime rename, promote live-smoke fixture replay tooling, add per-gate timing instrumentation, and preserve all prior mailbox/task-list invariants.

## Scope

- Reuse or author a non-default-role playbook (`architect-coder-qa`) and cover it in smoke paths.
- Add a fake-adapter revision-loop smoke that proves evaluator fail -> revision_request -> revision spawn -> success -> final_reconciliation.
- Bound the inbox delivery loop for no-progress shutdown races and drain the shutdown pass until the cursor is stable.
- Fix the lingering-handle / cleanup leak behind combined S3+S4+S5+S6 targeted vitest hangs.
- Rename authored/runtime mode selection to the provider-neutral `dispatchMode` field and update consumers/docs.
- Promote live-smoke fixture replay into helper infrastructure plus docs.
- Add `scripts/gate.mjs` timing headers and dogfood it for slice-end gates.
- Add the `isSessionIdle` race regression test and keep S1-S5 invariants intact.

## Status

Status: In progress (S6 closure)

## Tasks

1. Land Stage F coverage: custom playbook smoke surface plus revision-loop smoke.
2. Harden the inbox delivery loop and eliminate the combined-vitest lingering-handle path.
3. Complete the provider-neutral runtime rename and add the `isSessionIdle` race regression test.
4. Promote fixture-replay tooling, add gate timing instrumentation, and update docs.
5. Run R7/R8-compliant verification, capture the two live-smoke evidences, and write the S6 final report plus local-director integration handoff.

## Dependencies

- S6 bundle: `/workspace/tasks/remote/agent-teams-chat-mailbox-s6/spec.md`
- Base branch: `daytona/s5-final` (`573c336`)
- Capability gates: `paseo chat wait`, `paseo send --no-wait`, `timeout` (or wrapper fallback)

## Notes

- Lane DAG: `(1) Stage F smokes`, `(2) inbox determinism + vitest hang`, `(3) provider-neutral rename + isSessionIdle test`, `(4) fixture replay + gate timing`, then `(5) final gates + report`.
- The inbox delivery loop remains the single transport-backed control plane; S6 only hardens delivery and shutdown behavior around that loop.
- `revision_request` must keep synthesizing a new `spawn_request` path so revision work still emits `worker_complete` evidence.
- `smoke:live` is capped at two total invocations this slice: default playbook + custom playbook. Failures are captured as fixtures instead of rerunning live.
- The 4-way S1 integration stays out of scope for this branch; the final report must leave a conflict snapshot for the local director.
