# Plan: Wave A — governance, portability, catalog, spec hygiene

## Status

Status: Completed

## Source records read

- `.local/manager/handoff/state.md`
- `.local/manager/discovery-scan-2/gap-matrix-and-backlog.md`
- `.local/manager/spec-prd-trd-qa-rewrite/hierarchy/manifest.json`
- `.local/manager/slice-4-pull/local-acceptance.md`
- `.local/manager/slice-5-pull/local-acceptance.md`
- `.local/manager/slice-6-pull/local-acceptance.md`
- `.local/manager/slice-13-pull/local-acceptance.md`
- `.local/manager/wave-a-merge/`
- `.local/Logs/.opencode-jobs.json`

## Scope / delivered modules

- Slice #4: governance object seed, document-first projections, `GovernanceStore`, `pnpm governance`, and `pnpm documents` surfaces.
- Slice #5: execution portability foundation, workflow/runtime versioning, provider/result handoff, portable workflow sanitization, and reference-first evidence persistence.
- Slice #6: catalog and extensions backbone, manifest validation, activation/revocation lifecycle, curated fallback team config, and catalog provenance in evidence.
- Slice #13: spec-authoring hygiene automation, production mirror manifest compatibility, metadata/status/duplicate checks, `pnpm spec:hygiene`, and verify integration.

## Acceptance / verification evidence

- Slice #4 Stage C verdict: `NO_OBJECTIONS`; typecheck/build/eval/smoke:fake passed, full test had only known `runs-follow` stderr warning.
- Slice #5 Stage C verdict: `NO_OBJECTIONS` after local fixes for R6 sanitizer and R8 reference-first persistence; targeted portability/runtime/evidence tests passed.
- Slice #6 Stage C verdict: `NO_OBJECTIONS`; requirement-mapped catalog/extension tests passed; typecheck/build/eval/smoke:fake passed.
- Slice #13 Stage C verdict: `NO_OBJECTIONS`; object-map production mirror validation and documented CLI form were fixed; targeted spec hygiene tests passed.
- Wave A merge was recorded complete in `.local/manager/handoff/state.md` and job prompts in `.local/Logs/.opencode-jobs.json`.
- Known residual across local full-suite gates: `tests/cli/runs-follow.test.ts` stderr warning from npm config noise.

## Commit(s)

- `4c89850` — Wave A: slices #4, #5, #6, and #13.

## Residual / follow-up

- Keep spec hygiene input path documented as `pnpm spec:hygiene --input <path-to-mirror>`.
- Fix the shared `runs-follow` stderr warning so `pnpm verify` can be fully green.
