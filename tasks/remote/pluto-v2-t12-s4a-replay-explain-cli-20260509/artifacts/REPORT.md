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

## Fixup Addendum — 8 Reviewer Objections

1. Default run-dir
- Addressed: `runs.ts` now defaults to `.pluto/runs/<runId>` when `--run-dir` is omitted.
- Test: added a no-`--run-dir` replay test that discovers a fixture under `<cwd>/.pluto/runs/run-1`.

2. `explain` reads `projections/tasks.json`
- Addressed: `explainRun()` now reads on-disk `projections/tasks.json` when present, compares it against replay-derived tasks, sets `tasksDriftDetected`, and prefers the on-disk projection for displayed tasks.
- Test: text and JSON coverage assert drift detection and that on-disk task fields win.

3. Citations / evidence list
- Addressed: `ExplainOutput` now includes `citations` from `evidence-packet.json`, and text output renders them in an `Evidence` section.
- Test: text and JSON coverage assert citations are surfaced.

4. Structured failure classification
- Addressed: classification now prefers structured signals from `evidence/final-reconciliation.json.audit.status` and `evidence-packet.json.runtimeDiagnostics`, then falls back to summary heuristics only when needed.
- Added: `failureClassificationSource` and explicit diagnostics rendering in text output.
- Test: JSON coverage asserts `structured` classification sourced from a failed-audit projection and runtime diagnostics.

5. RunId vs on-disk mismatch
- Addressed: replay/explain now check `state/run-state.json` first, then the first event's `runId`; mismatches return `RUN_ID_MISMATCH: expected X, found Y` with exit code 2.
- Test: replay and explain both have mismatch coverage.

6. Task history / closeouts
- Addressed: task history is reconstructed from `task_state_changed` events and emitted in JSON plus indented text output.
- Test: text and JSON coverage assert chronological transition history is present.

7. Best-effort authored-spec recovery
- Addressed: authored-spec parsing is now wrapped in best-effort recovery. Parse failures emit a warning and replay falls back to inferred actors plus empty initial tasks.
- Test: malformed `authored-spec.yaml` no longer blocks replay.

8. Docs / QA updates
- Addressed: `README.md` now lists `pluto:run` plus the `pluto:runs replay|explain` inspection surface in the top supported-surface summary.
- Addressed: `docs/qa-checklist.md` now has a combined replay/explain finished-run output check.
- No additional change needed: `docs/harness.md` already states that `pluto:runs` is post-run inspection only, and `docs/testing-and-evals.md` already includes `pluto:runs replay` in canonical commands.

## Fixup Gates
- typecheck: PASS
- runs.test.ts: 9/9
- runtime tests: 265/267

## Fixup Commit SHAs
- implementation-fixup-commit-sha: 1b3e125444bbcb31df0a49cc7ca677a22551fcc3
- report-addendum-commit-sha: 0b97e592ce9f30a749de60cad8e4681febeab37a
