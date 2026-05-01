# Plan: Wave B — review/publish identity/security/storage

## Status

Status: Completed

## Source records read

- `.local/manager/handoff/state.md`
- `.local/manager/discovery-scan-2/gap-matrix-and-backlog.md`
- `.local/manager/slice-7-pull/local-acceptance.md`
- `.local/manager/slice-8-pull/local-acceptance.md`
- `.local/manager/wave-b-merge/`
- `.local/Logs/.opencode-jobs.json`

## Scope / delivered modules

- Slice #7: review, approval, publish package, release readiness, sealed evidence readiness, evidence graph store, decision/audit lifecycle, and review/publish/release CLI surfaces.
- Slice #8: workspace/org/member/service-account/API token identity model, authorization and revocation, security contracts, SecretRef/scoped permits, tool gateway, outbound approval, storage contracts, retention/deletion/legal hold/tombstone boundaries, and local-v0 compatibility fences.

## Acceptance / verification evidence

- Slice #7 Stage C verdict: `NO_OBJECTIONS`; mandatory Slice #7 tests passed, and storage/audit/evidence boundaries were accepted.
- Slice #8 Stage C verdict: `NO_OBJECTIONS`; identity/security/storage/boundary tests passed and smoke:live env-blocker remained accepted as non-blocking.
- `pnpm typecheck`, `pnpm build`, `pnpm eval:workflow`, and `pnpm smoke:fake` passed in local acceptance flows.
- `pnpm test` / `pnpm verify` remained soft-fail only because of the known `tests/cli/runs-follow.test.ts` stderr warning.

## Commit(s)

- `c6e63b6` — Wave B: slices #7 and #8.

## Residual / follow-up

- No Wave B-specific objections remain.
- Shared residual remains the `runs-follow` stderr warning.
