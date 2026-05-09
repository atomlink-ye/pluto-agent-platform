# T12-S4a Report — pluto:runs replay + explain

## Summary
Added a new runtime CLI at `pnpm pluto:runs` with `replay` and `explain` subcommands. `replay` re-folds `events.jsonl` through the closed reducer and checks the canonical task projection for drift; `explain` summarizes run metadata, actors, tasks, mailbox traffic, artifacts, and optional final-reconciliation evidence.

## Files added/changed
- `packages/pluto-v2-runtime/src/cli/runs.ts`
- `packages/pluto-v2-runtime/__tests__/cli/runs.test.ts`
- `package.json`
- `README.md`
- `docs/harness.md`
- `docs/testing-and-evals.md`
- `docs/qa-checklist.md`
- `docs/plans/active/v2-harness-polish-gpt-pro-followups.md`

## Run on-disk layout assumptions
- `events.jsonl` is the replay source of truth.
- `projections/tasks.json` is the canonical materialized projection for `replay` parity checks.
- `projections/mailbox.jsonl` and `projections/artifacts.json` are the primary explain-time views.
- `artifacts/*.txt` is treated as the artifact sidecar directory when present.
- `evidence/final-reconciliation.json` is optional and only rendered when present.
- Provenance: current runtime write paths come from `src/cli/v2-cli-bridge.ts` (`writeRunArtifacts`), with root-level `tasks.json` / `mailbox.jsonl` fallback retained for older fixture layouts.

## Decisions made
- Used `projections/tasks.json` as the replay parity target instead of inventing a new persisted run-state file.
- Reconstructed reducer context from `run_started` metadata plus inferred actors, with optional authored-spec recovery when a colocated spec file exists.
- Filtered authored-spec actors back down to the closed kernel role set before seeding reducer state.
- Made `explain` tolerate both current projection layout and older root-level fixture layouts so smoke work does not depend on one capture shape.

## Approaches considered and rejected
- Writing a new `state/projection.json` artifact in this slice: rejected to keep T12-S4a additive and avoid changing runtime persistence.
- Comparing replay output against `evidence-packet.json`: rejected because the task projection is the direct materialized event-derived view that matches current runtime writes.
- Requiring `evidence/final-reconciliation.json` for `explain`: rejected because T12-S3 lands that evidence later and the prompt requires graceful absence.

## Gates
- typecheck: PASS
- runs.test.ts: 4/4
- runtime tests: 255/257
- replay smoke: PASS
- explain smoke: PASS

## Stop conditions hit
- No checked-in v2 run directory with the current `projections/` layout was available locally for smoke execution, so a synthetic run bundle was generated under `/tmp` for the replay/explain smoke commands.

## Verdict
T12-S4a COMPLETE
implementation-commit-sha: 1db9e1551aed55adeb3758f838e590096e5474aa
report-commit-sha: 3dfed2da424240282e5d7e5ea20998544c5d13d9
status: PASS
