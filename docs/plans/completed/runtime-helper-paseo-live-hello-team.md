# Plan: Runtime helper Paseo live hello-team

## Goal
Make the opt-in runtime-helper mailbox MVP succeed on a real `paseo-opencode` `hello-team` run in `/Volumes/AgentsWorkspace/tmp/pluto-symphony-custom-test/symphony`, while adding a real helper-wait path, reducing redundant lead-session noise, and keeping default non-flagged behavior unchanged.

## Final status
- [ ] Not started
- [ ] In progress
- [ ] Blocked
- [x] Complete

## Delivered
- Server-mediated helper `wait` requests so agents block on Pluto's side instead of local polling loops.
- Semantic lead-envelope suppression for already-handled `spawn_request`, `worker_complete`, `evaluator_verdict`, `final_reconciliation`, and plan-approval traffic.
- Clearer helper CLI help and stricter prompt guidance for exact task-id usage and role-local helper usage.
- Final-artifact citation backfill so live summaries still satisfy audit requirements when the lead omits a completion id.

## Verification
- `pnpm typecheck`
- `pnpm test tests/orchestrator/runtime-helper.test.ts tests/four-layer/inbox-delivery-loop.test.ts tests/four-layer-loader-render.test.ts tests/orchestrator/teamlead-driven-dispatch.test.ts tests/manager-run-harness.test.ts -- --reporter verbose`
- Real live run:
  - Command: `PLUTO_DISPATCH_MODE=teamlead_chat PLUTO_RUNTIME_HELPER_MVP=1 pnpm pluto:run --scenario hello-team --run-profile fake-smoke --workspace "/Volumes/AgentsWorkspace/tmp/pluto-symphony-custom-test/symphony" --adapter paseo-opencode --data-dir "/Volumes/AgentsWorkspace/tmp/pluto-symphony-custom-test/symphony/.pluto-runtime-helper-live-hybrid-v4"`
  - Run id: `d70c1521-ceaf-43ff-9fb4-dc79502bdde3`
  - Status: `succeeded`

## Live evidence
- Lead session: `96b827ad-a7c0-46b2-b20c-c4ac9f2a0e93`
- Planner session: `6d961016-7bad-41e1-8d84-8f110a516b0e`
- Generator session: `c764e850-6b0e-4fa1-bfa8-372ebcdce53d`
- Evaluator session: `54a9d398-5ba3-418c-9dce-a9086bbfb874`
- Helper-wait usage is visible in `runtime-helper-usage.jsonl` for lead waits on `task-1`, `task-2`, and `task-3`.
- Redundant lead-session noise reduction is visible in `events.jsonl` `mailbox_message_delivered` entries with `deliveryMode: "runtime_helper_semantic"` for `run_start_notice`, `lead_spawn_request`, `lead_worker_complete`, `lead_evaluator_verdict`, and `lead_final_reconciliation`.
- Direct session inspection confirmed the lead followed the helper wait flow instead of blind file polling:
  - `paseo inspect 96b827ad-a7c0-46b2-b20c-c4ac9f2a0e93`
  - `paseo logs 96b827ad-a7c0-46b2-b20c-c4ac9f2a0e93 --filter text --tail 200`

## Notes
- Intermediate live runs exposed two concrete blockers that were fixed during this pass: stale `hasPendingWait` interception logic and missing completion-id citations in the final artifact.
- Default behavior outside `PLUTO_RUNTIME_HELPER_MVP=1` remains unchanged.
