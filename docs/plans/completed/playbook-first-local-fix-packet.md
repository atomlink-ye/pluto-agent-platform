# Plan: playbook-first local fix packet

## Status

Status: Completed

## Goal

Resolve the four local review objections against the shipped playbook-first harness without expanding scope beyond the documented fix packet.

## Completed scope

- Moved fail-closed run-profile validation and repo required-read verification ahead of workspace/run-dir materialization so unsupported launches return a failed result without writing lifecycle artifacts.
- Added repo-root containment for `required_reads.kind=repo` and regression coverage for both escape attempts and other pre-launch rejection paths.
- Made workflow/deviation reporting explicitly synthesized from routed worker intent plus explicit lead `DEVIATION:` lines in the v1 bridge, and aligned audit-middleware messaging with that bridge reality.
- Revised the canonical/runtime design docs to describe the shipped v1 lead-intent compatibility bridge honestly while preserving TeamLead-owned `paseo run` recursion as deferred v1.5+ work.

## Verification evidence

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm smoke:fake`
- `pnpm verify`

## Remaining follow-up

- True TeamLead-owned child spawning plus room-backed STAGE/DEVIATION observation remains deferred beyond v1.
- The local director handoff note at `.local/manager/handoff/state.md` is not committed in this worktree; the canonical design doc now references that local deferral point plus the repo architecture follow-up plan so the bridge status stays aligned when the local note is present.
