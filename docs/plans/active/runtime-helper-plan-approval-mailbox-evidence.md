# Plan: Runtime helper plan-approval mailbox evidence

> **Status (2026-05-07):** this plan targets the v1.6 runtime helper / plan-approval
> lineage, which is now frozen as legacy. The active replacement is
> [`docs/plans/active/v2-rewrite.md`](v2-rewrite.md). Items here should not be re-opened
> against `main` until the v2 acceptance gates land.

## Status

Status: Active. Captured 2026-05-03 from the Slice A `pnpm smoke:live` run that surfaced the issue.

## Goal

Investigate and fix the assertion failure surfaced by `pnpm smoke:live` after the Slice A runtime-helper hardening landed:

> `assertion_failed: mailbox.jsonl is missing the plan-approval round-trip messages`

The live run itself completed with `status: succeeded`, but the post-run validator could not find the expected `plan_approval_request` / `plan_approval_response` envelopes on the mirrored `mailbox.jsonl`.

## Why it is a separate slice

- It is **not** caused by Slice A. Slice A only changed runtime-helper materialization, authority resolution, polling-server lifecycle, and 3 helper tests. It did not touch plan-approval routing or the mirrored mailbox writer.
- It is **not** a test-suite hang or a flake — full `pnpm test` and targeted runtime-helper tests pass cleanly. The issue is specific to the live-smoke validator's expectation against a real run.
- It needs its own diagnosis lane and its own commit boundary.

## Captured fixture

Use the fixture at `tests/fixtures/live-smoke/a55b71bb-b794-4a67-9d11-eb8d23cea701/` as the primary debug surface. R8 binds: do **not** rerun `pnpm smoke:live` to debug this — iterate via fixture-replay tests until the root cause is understood and fixed, then run smoke:live ONCE at slice end.

Fixture contents:
- `events.jsonl` — full event timeline
- `mailbox.jsonl` — mirrored mailbox transcript that the validator complains about
- `tasks.json` — task ledger
- `runtime-helper-usage.jsonl` — helper command invocations
- `runtime-helper-responses/` — helper response files
- `paseo-agent-ls.txt`, `paseo-chat-ls.txt` — live runtime snapshots at run end

## Suspected scope

Likely lives in one of:
- `src/orchestrator/manager-run-harness.ts` (plan-approval round-trip handling)
- `src/orchestrator/inbox-delivery-loop.ts` (mailbox mirror writes for plan-approval kinds)
- `src/four-layer/mailbox.ts` / `src/four-layer/mailbox-transport.ts` (mirror semantics)
- `docker/live-smoke.ts` (validator's plan-approval assertion — may be wrong, not the runtime)

A first-pass diagnostic should:
1. Read the captured `mailbox.jsonl` and confirm whether plan-approval messages are physically absent or just shaped differently from the validator's expectation.
2. Inspect the live `events.jsonl` for any `plan_approval_*` events to see whether the round-trip happened at runtime but did not get mirrored.
3. Check whether the validator's check is testing the right surface (mailbox.jsonl vs paseo chat room transcript).

## Out of scope

- Any docs-as-config refactor phase ≥2 work
- Any chat-poster swap (architecture synthesis 2026-05-03 dropped that)
- Slice A's runtime-helper changes (already accepted and committed)

## Verification target

- A targeted unit test that replays the captured fixture through the validator path and pinpoints which expectation fails.
- A fix in the actual runtime path (or validator) so the fixture replay passes.
- One bounded `pnpm smoke:live` rerun at slice end producing a fresh run that the validator accepts.
