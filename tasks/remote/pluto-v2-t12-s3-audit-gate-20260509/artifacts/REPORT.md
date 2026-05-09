# T12-S3 Report — Final-reconciliation audit gate

## Summary
Extended `final-reconciliation` to validate cited tasks, mailbox messages, and artifact refs against a single live PromptView snapshot before terminating the run. The runtime now emits `evidence/final-reconciliation.json`, returns an `auditSummary` block to the actor, and marks audit failures as `failed` with a `FAILED_AUDIT: ` summary prefix without touching the closed kernel.

## Files changed
- `packages/pluto-v2-runtime/src/api/composite-tools.ts` — added audit validation, failure envelope shaping, and runtime evidence writing.
- `packages/pluto-v2-runtime/src/tools/pluto-tool-handlers.ts` — extended `PlutoToolSession` with an optional `runDir` seam for runtime evidence output.
- `packages/pluto-v2-runtime/src/api/pluto-local-api.ts` — threads `runDir` into local API sessions, which is the only composite-tool execution path.
- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts` — passes the real run root dir into the local API session context.
- `packages/pluto-v2-runtime/src/cli/pluto-tool.ts` — accepts optional `--cited-artifact-ref` and `--unresolved-issue` flags and documents mailbox-sequence citations.
- `packages/pluto-v2-runtime/__tests__/api/composite-tools.test.ts` — covers pass, unresolved issues, and each required audit failure kind, including evidence-file assertions.
- `packages/pluto-v2-runtime/__tests__/cli/pluto-tool.test.ts` — updates final-reconciliation CLI parsing coverage and provides a temp run dir for evidence writes.

## Citation source choice
- Completed tasks: `PromptView.tasks[].id` plus terminal-state validation from `PromptView.tasks[].state`.
- Cited messages: `PromptView.mailbox[].sequence`, stringified. PromptView does not expose stable mailbox message ids, while the transcript sidecar is free-form text without structured ids, so mailbox sequence is the closest structured, live, actor-visible citation handle.
- Cited artifacts: `PromptView.artifacts[].id`, which already reflects the runtime artifact registry surface exposed to actors.

## Decisions made
- Kept kernel status values unchanged and mapped audit failure to `complete_run(status="failed")` with a `FAILED_AUDIT: ` summary prefix.
- Read PromptView once inside `runFinalReconciliation` and performed all citation checks from that single snapshot.
- Returned the full `auditSummary` block in the composite tool result so the actor gets immediate structured feedback on bad citations.
- Wrote `evidence/final-reconciliation.json` from the runtime layer instead of introducing a kernel projection.
- Kept the `runDir` seam local to local-API composite execution by adding `runDir?: string` to `PlutoToolSession` instead of threading a required field through every session construction site.

## Approaches considered and rejected
- Using transcript text as the cited-message source: rejected because the transcript sidecar has no structured message ids and would require brittle text matching.
- Adding a dedicated evidence module under `src/evidence/`: rejected to keep the slice localized to the existing composite-tool runtime seam.
- Making `runDir` mandatory on every `PlutoToolSession`: rejected because composite tools only execute through the local API path, so an optional session seam was smaller and sufficient.

## Gates
- typecheck: FAIL exit=2
- composite tests: 11/11
- runtime tests: 256/258
- core tests: 196/196

Core test note: `pnpm --filter @pluto/v2-core test` is a no-op here because `packages/pluto-v2-core/package.json` has no `test` script. I ran `pnpm exec vitest run` from `packages/pluto-v2-core/` to capture the actual core suite result.

## Stop conditions hit
none

## Verdict
T12-S3 COMPLETE
implementation-commit-sha: c83d7209b75d725054cab8124078558d1390c4a8
report-commit-sha: self-referential; use `git rev-parse HEAD` after the report commit
status: PARTIAL
