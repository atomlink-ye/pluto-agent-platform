# T5-D2b Report

- Date: 2026-05-08
- Branch: `pluto/v2/t5-d2b-wait-feasibility`
- Worktree: `/workspace/.worktrees/pluto-v2-t5-d2b-wait-feasibility-20260508/integration`

## Summary

```text
T5-D2b RESULT
single-flight session: pass
B-completes-before-A-wait: yes, 21501ms
A-cancellation cleanup: clean
tightest-timeout-in-chain: server wait cap @ 120s
recommendation: GO
```

## What Was Tested

- Live Paseo/OpenCode single-flight proof with Actor A blocked in a 30s wait and Actor B performing an immediate read over the same localhost proof endpoint.
- Live cancellation proof with Actor A2 blocked in a 120s wait, interrupted via `paseo stop`, followed by Actor B2 progress check.
- Live timeout-boundary proof with Actor A3 holding a 120s wait to see whether a hidden OpenCode/Paseo cap fired before the server-side wait.
- Local Node HTTP fallback probes for single-flight behavior and disconnect handling.

## What Worked

- Actor B completed while Actor A was still blocked, with a `21501ms` gap before A's wait returned.
- `paseo stop` caused the blocked HTTP request to disconnect cleanly (`9615ms` observed total wait time on A2).
- A separate actor progressed after cancellation.
- A full 120s wait completed normally; no shorter runtime timeout appeared first.

## What Did Not Work

- Required typecheck gates are currently red for pre-existing repo reasons outside D2b scope.
- Baseline blocker examples:
  - `packages/pluto-v2-core/package.json` does not declare `zod` although baseline source imports it.
  - baseline type errors already exist across `packages/pluto-v2-core/**` and `packages/pluto-v2-runtime/src/**`.

## Recommendation

- **GO** for T5-S2b runtime feasibility.
- Caveat: D2b did not prove atomic arm/park or cursor correctness. S2b still needs a real wait registry that prevents lost wakeups.

## Gate Status

- Manual `pnpm install --frozen-lockfile`: passed.
- Task-driver `gate_typecheck`: failed on pre-existing baseline errors before root typecheck could run.
- Task-driver `gate_diff_hygiene`: passed.
- Task-driver `run_proof`: passed with exit `0` after a temporary untracked symlink workaround inside `packages/pluto-v2-runtime/` because `commands.sh` resolves `tsx packages/pluto-v2-runtime/scripts/smoke-wait-feasibility.ts` from the filtered package cwd rather than repo root.
- Task-driver `commit_and_push`: created local commit `7a54b34fb03d9eaa778bee52e20ae286faff39b1`, but push failed on auth (`fatal: could not read Username for 'https://github.com': No such device or address`).
- Task-driver `force_add_report`: created local commit for the copied report, and its push also failed on auth (`WARN: push failed (auth) — operator handles locally`).
