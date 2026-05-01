# Plan: Wave C+D — schedule, observability, compliance, bootstrap

## Status

Status: Completed

## Source records read

- `.local/manager/handoff/state.md`
- `.local/manager/discovery-scan-2/gap-matrix-and-backlog.md`
- `.local/manager/slice-9-pull/local-acceptance.md`
- `.local/manager/slice-10-pull/local-acceptance.md`
- `.local/manager/slice-11-pull/local-acceptance.md`
- `.local/manager/slice-12-pull/local-acceptance.md`
- `.local/manager/wave-cd-merge/`
- `.local/Logs/.opencode-jobs.json`

## Scope / delivered modules

- Slice #9: schedule and integration trigger contracts, stores, evaluation, dispatch guards, inbound normalization, outbound delivery, webhook signing/idempotency/replay protection, projections, and CLI surfaces.
- Slice #10: observability contracts/store/query/redaction, budget gates, run/evidence/adapter health summaries, upgrade contracts/store/lifecycle, approval/backup/rollback controls, readiness CLI and docs hooks.
- Slice #11: compliance contracts, retention/legal-hold/delete controls, audit export bundles, portability bundle store, sealing, import validation, conflict handling, and compliance/portability CLIs.
- Slice #12: bootstrap first workspace, full `Workspace -> Document -> Version -> Run -> Artifact -> EvidencePacket` chain, readiness gating, bootstrap reconciliation, and bootstrap CLI status/workspace flows.

## Acceptance / verification evidence

- Slice #9 verdict: `PASS_WITH_NONBLOCKING_WARNING`; all requirement-mapped schedule/integration tests passed.
- Slice #10 verdict: `NO_OBJECTIONS`; all requirement-mapped observability/ops tests passed.
- Slice #11 verdict: `ACCEPTED_WITH_NON_BLOCKING_WARNING`; compliance/export portability tests passed.
- Slice #12 verdict: `FIXED_WITH_KNOWN_RESIDUAL`; Stage C objections around bootstrap R4-R6 chain and blocked `reviewReady` were fixed locally; targeted bootstrap and CLI tests passed.
- Wave C+D merge was recorded complete in `.local/manager/handoff/state.md` and merge job metadata appears in `.local/Logs/.opencode-jobs.json`.
- Known residual: full `pnpm test` and `pnpm verify` still trip `tests/cli/runs-follow.test.ts` due npm stderr warning.

## Commit(s)

- `c905f83` — Wave C+D: slices #9, #10, #11, and #12.

## Residual / follow-up

- No Wave C+D-specific objections remain.
- Shared residual remains the `runs-follow` stderr warning.
