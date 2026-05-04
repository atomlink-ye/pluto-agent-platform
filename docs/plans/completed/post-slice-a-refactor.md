# Plan: Post-Slice-A refactor pass

## Status
Completed 2026-05-04. All 8 phases (R1–R8) landed across 11 commits on
the `post-slice-a-refactor` branch. Final state: `pnpm verify` green —
typecheck 0 errors, vitest 737/737, build, smoke:fake, no-paseo blocker
check. All file-size targets hit except `paseo-opencode-adapter.ts`
which lands at 676 vs the ~450 target (residual is constructor / env
init / callback identity wiring on the class itself; deferred as a
future S-effort). See `.local/REFACTOR_REPORT_FINAL.md` for the per-phase
verdict matrix, commit map, and remaining follow-ups.

## Goal
Shrink the modules that accumulated multiple responsibilities over successive slices, starting with the manager harness and the duplicated test/control-plane scaffolding around it. Preserve public APIs, event shapes, artifacts, and runtime behavior while extracting focused modules that make future slices cheaper and safer.

## Source records read
- `docs/plans/active/pluto-paseo-docs-as-config-refactor.md`
- `src/orchestrator/manager-run-harness.ts`
- `src/bootstrap/workspace-bootstrap.ts`
- `src/four-layer/loader.ts`
- `src/orchestrator/evidence.ts`
- `src/adapters/paseo-opencode/paseo-opencode-adapter.ts`
- `src/contracts/portability.ts`
- `src/contracts/compliance.ts`
- `src/contracts/observability.ts`
- `src/contracts/publish.ts` (symbol scan)
- `src/contracts/review.ts` (symbol scan)
- `src/contracts/integration.ts` (symbol scan)
- `src/contracts/ops.ts` (symbol scan)
- `src/cli/run.ts`
- `src/cli/package.ts`
- `src/cli/runs.ts`
- `src/cli/schedules.ts`
- `tests/manager-run-harness.test.ts`
- `tests/orchestrator/structured-control-plane.test.ts`
- `tests/orchestrator/runtime-helper.test.ts`
- `tests/paseo-opencode-adapter.test.ts`

## Diagnosis: where the codebase grew over multiple iterations
- `src/orchestrator/manager-run-harness.ts` — 2396 lines.
  - It combines run compilation/bootstrap (`145-224`), mailbox/audit runtime plumbing (`249-454`), workspace/run startup (`483-616`), the entire lead control-plane (`617-1697`), failure handling (`1922-1991`), and reporting/render helpers (`1993-2396`).
  - The biggest duplication is in dispatch execution: near-identical spawn/worker-launch logic appears in `815-965` and `1340-1487`, with matching completion/finalization branches in `967-1048` and `1488-1589`. Static-loop worker execution in `1604-1691` repeats the same worker-session + assignment + completion flow a third time.
  - This file should yield focused harness modules under `src/orchestrator/harness/` rather than one more “mega helper” file.
- `src/bootstrap/workspace-bootstrap.ts` — 1284 lines.
  - It currently mixes public bootstrap commands (`148-387`), blocked-state/session writing (`693-761`), bootstrap artifact/materialization (`763-851`), status reconciliation (`853-965`), store/ref/session builders (`967-1147`), and metadata/ledger persistence (`1149-1284`).
  - The domain is coherent; the problem is orchestration, status projection, and record construction living in one module.
- `src/four-layer/loader.ts` — 1200 lines.
  - It bundles workspace loading (`95-148`), per-kind validation (`149-324`), YAML parsing (`326-339`, `965-1200`), normalization (`404-677`), selection/overlay resolution (`679-789`), and generic validation helpers (`823-964`).
  - This is a good candidate for a façade file over `yaml-lite`, authored-schema validation, normalization, and selection-resolution modules.
- `src/orchestrator/evidence.ts` — 865 lines.
  - The file is conceptually one namespace, but it still holds five jobs: redaction (`29-50`), packet validation (`53-385`), packet generation (`477-590`), orchestration/provenance extraction (`592-784`), and rendering/writing (`786-865`).
  - This should stay one public surface, but not one implementation file.
- `src/adapters/paseo-opencode/paseo-opencode-adapter.ts` — 880 lines.
  - It mixes adapter lifecycle (`177-335`), message send/idle/end logic (`368-497`), CLI command wrappers (`505-631`), log text parsing (`634-711`), and prompt builders (`713-807`).
  - The public class is fine; the internal seams are not.
- Test harness duplication is now expensive.
  - `tests/orchestrator/structured-control-plane.test.ts:345-613` and `tests/orchestrator/runtime-helper.test.ts:872-1116` both define near-identical run bootstrap, transport capture, mailbox-envelope posting, wait helpers, JSONL readers, and env wrappers.
  - `tests/manager-run-harness.test.ts:20-224` repeats temp workspace/data-dir setup patterns that belong in a shared harness fixture.
  - `tests/paseo-opencode-adapter.test.ts:145-188` has a useful mocked `ProcessRunner` builder that should become a reusable test helper if the adapter is split.
- CLI surface duplication is real but small and low-risk.
  - `src/cli/run.ts:21-78` and `src/cli/package.ts:17-68` duplicate flag parsing and run-selection assembly.
  - `src/cli/runs.ts:26-67` and `src/cli/schedules.ts:9-56` duplicate usage/error/`parseArgs`/`PLUTO_DATA_DIR` resolution patterns.
- Contracts are mostly domain-cohesive, but each large file mixes schema declarations with constructors/parsers/validators.
  - `src/contracts/portability.ts` puts schemas/types in `1-239` and coercion/validation in `242-956`.
  - `src/contracts/compliance.ts` puts schemas/types in `1-267` and parsing/evaluation/validation in `269-888`.
  - `src/contracts/observability.ts` puts schemas/types in `1-223` and validation utilities in `224-776`.
  - Spot checks show the same layout in `src/contracts/publish.ts` (`8-142` types, `158-442` normalizers/validators), `src/contracts/review.ts` (`3-188` types, `493-700` validators), `src/contracts/integration.ts` (`1-178` types, `301-496` validators), and `src/contracts/ops.ts` (`3-167` types, `283-623` normalizers/validators).
  - The right refactor is not “invent new domains”; it is “split schema vs validation/normalization while keeping current domain namespaces and import paths stable.”

## Refactor phases

### Phase R1 — Shared test fixtures and mailbox-driver helpers
- Maps to umbrella plan phase: orthogonal
- Scope (files in / files out)
  - In: `tests/orchestrator/runtime-helper.test.ts`, `tests/orchestrator/structured-control-plane.test.ts`, `tests/manager-run-harness.test.ts`, `tests/paseo-opencode-adapter.test.ts`, new `tests/helpers/*`
  - Out: `src/**`, runtime helper protocol, any production behavior
- Concrete extraction targets (new modules + signatures, new test helpers)
  - `tests/helpers/harness-run-fixtures.ts`
    - `createHarnessRun(options): Promise<{ runId; runDir; workspace; roomRef; transport; adapter; resultPromise }>`
    - `waitForEvent(runDir, predicate, timeoutMs?)`
    - `waitForTasks(runDir, expectedCount)`
    - `readEvents(runDir)`, `readTasks(runDir)`, `readJsonLines(path)`
    - `withEnv(entries, fn)`
  - `tests/helpers/mailbox-fixtures.ts`
    - `createMailboxMessage(input)`
    - `buildEnvelope(runId, message)`
    - `postSpawnRequest(...)`, `postWorkerComplete(...)`, `postEvaluatorVerdict(...)`, `postRevisionRequest(...)`, `postShutdownRequest(...)`, `postShutdownResponse(...)`, `postFinalReconciliation(...)`
  - `tests/helpers/process-runner.ts`
    - `makeProcessRunner(overrides)` extracted from `tests/paseo-opencode-adapter.test.ts:145-188`
- Acceptance: file size targets, test coverage to preserve, behavioral invariants
  - Delete the duplicate helper blocks now at `tests/orchestrator/structured-control-plane.test.ts:335-613` and `tests/orchestrator/runtime-helper.test.ts:862-1116`.
  - Preserve all existing assertions and test names in the touched suites.
  - No production import path changes.
- Verification: targeted tests + full pnpm test gate
  - `pnpm test -- tests/orchestrator/structured-control-plane.test.ts tests/orchestrator/runtime-helper.test.ts tests/manager-run-harness.test.ts tests/paseo-opencode-adapter.test.ts`
  - `pnpm test`
- Estimated effort: S

### Phase R2 — CLI shared parsing and output utilities
- Maps to umbrella plan phase: orthogonal
- Scope (files in / files out)
  - In: `src/cli/run.ts`, `src/cli/package.ts`, `src/cli/runs.ts`, `src/cli/schedules.ts`, optionally adjacent CLI commands that match the exact same parser pattern, new `src/cli/shared/*`
  - Out: CLI command semantics, JSON shapes, exit codes
- Concrete extraction targets (new modules + signatures, new test helpers)
  - `src/cli/shared/flags.ts`
    - `parseKeyValueFlags(argv, spec)`
    - `parseSubcommandArgs(argv)`
    - `resolvePlutoDataDir(): string`
  - `src/cli/shared/run-selection.ts`
    - `buildRunSelection(flags): { scenario: string; runProfile?: string; playbook?: string; runtimeTask?: string }`
  - `src/cli/shared/output.ts`
    - thin JSON/error helpers only if they reduce duplication without hiding behavior
- Acceptance: file size targets, test coverage to preserve, behavioral invariants
  - Remove duplicated parsing logic from `src/cli/run.ts:21-78`, `src/cli/package.ts:17-68`, `src/cli/runs.ts:41-67`, and `src/cli/schedules.ts:22-49`.
  - `run.ts` and `package.ts` should keep the same flag names and output shapes.
  - `runs.ts` / `schedules.ts` should keep the same human-readable output formatting.
- Verification: targeted tests + full pnpm test gate
  - `pnpm test -- tests/cli/*.test.ts`
  - `pnpm test`
- Estimated effort: S

### Phase R3 — Manager harness support extraction (preflight, reporting, failure path)
- Maps to umbrella plan phase: 4
- Scope (files in / files out)
  - In: `src/orchestrator/manager-run-harness.ts`, new `src/orchestrator/harness/*`
  - Out: mailbox transport semantics, runtime-helper semantics, adapter behavior
- Concrete extraction targets (new modules + signatures, new test helpers)
  - `src/orchestrator/harness/preflight.ts`
    - `buildPlaybookMetadata(playbook)`
    - `validateRunProfileRuntimeSupport(runProfile)`
    - `verifyRequiredReads(rootDir, requiredReads)`
    - `materializeRunWorkspace(workspace, rootDir, workspaceDir, runId)`
  - `src/orchestrator/harness/reporting.ts`
    - `buildSummaryRequest(...)`
    - `buildFallbackSummary(...)`
    - `ensureArtifactMentions(...)`
    - `ensureCompletionMessageCitations(...)`
    - `selectFinalArtifactMarkdown(...)`
    - `renderTaskTree(...)`, `renderStatusDoc(...)`, `renderFinalReport(...)`
    - `firstNonEmptyLine(...)`
  - `src/orchestrator/harness/failure.ts`
    - `finishManagerHarnessFailure(input): Promise<ManagerRunHarnessResult>`
- Acceptance: file size targets, test coverage to preserve, behavioral invariants
  - Move the pure/supportive code now concentrated in `manager-run-harness.ts:1922-2396` and the preflight helpers in `1993-2055` out of the main file.
  - Reduce `src/orchestrator/manager-run-harness.ts` below ~1800 lines.
  - Event names, artifact markdown, status docs, and failure packets remain byte-stable in tests.
- Verification: targeted tests + full pnpm test gate
  - `pnpm test -- tests/manager-run-harness.test.ts tests/evidence*.test.ts`
  - `pnpm test`
- Estimated effort: M

### Phase R4 — Manager harness control-plane and mailbox runtime split
- Maps to umbrella plan phase: 4
- Scope (files in / files out)
  - In: `src/orchestrator/manager-run-harness.ts`, new `src/orchestrator/harness/mailbox-runtime.ts`, `src/orchestrator/harness/control-plane.ts`, `src/orchestrator/harness/dispatch-executor.ts`
  - Out: `src/orchestrator/runtime-helper.ts`, mailbox transport implementations, `paseo chat` transport code
- Concrete extraction targets (new modules + signatures, new test helpers)
  - `src/orchestrator/harness/mailbox-runtime.ts`
    - `createMailboxRuntime(input): { sendMailboxMessage; recordMailboxMessageEvent; auditRuntimeMirrors; auditMailboxTransportParity; resolveMailboxOrchestrationSource; mailboxRef }`
  - `src/orchestrator/harness/dispatch-executor.ts`
    - `executeDispatchEntry(input): Promise<{ output: string; workerSessionId: string; completionMessage?: MailboxMessage }>`
  - `src/orchestrator/harness/control-plane.ts`
    - `createLeadControlPlane(input): { handleLeadMailboxMessage(message); autoRespondToPlanApproval(message); postSpawnRequest(entry, rationale?); postFinalReconciliation(); finalReconciliationPromise }`
  - Explicit duplication to remove:
    - spawn/claim/launch/assignment/completion flow duplicated at `815-965` and `1340-1487`
    - completion/finalization flow duplicated at `967-1048` and `1488-1589`
    - static-loop worker launch flow at `1604-1691` should call the same extracted dispatch executor instead of keeping a third copy
- Acceptance: file size targets, test coverage to preserve, behavioral invariants
  - Reduce `src/orchestrator/manager-run-harness.ts` below ~1100 lines.
  - Preserve event ordering and payload content for `spawn_request_*`, `worker_complete_*`, `evaluator_verdict_*`, `revision_request_*`, `shutdown_*`, and `final_reconciliation_*` events.
  - Do not change mailbox transport ownership or runtime-helper protocol.
- Verification: targeted tests + full pnpm test gate
  - `pnpm test -- tests/orchestrator/structured-control-plane.test.ts tests/orchestrator/runtime-helper.test.ts tests/manager-run-harness.test.ts`
  - `pnpm test`
- Estimated effort: L

### Phase R5 — Paseo/OpenCode adapter internal façade split
- Maps to umbrella plan phase: 2
- Scope (files in / files out)
  - In: `src/adapters/paseo-opencode/paseo-opencode-adapter.ts`, new sibling modules in `src/adapters/paseo-opencode/`
  - Out: mailbox transport code, runtime orchestration decisions, public adapter class name
- Concrete extraction targets (new modules + signatures, new test helpers)
  - `src/adapters/paseo-opencode/paseo-cli-client.ts`
    - `runAgent(...)`, `waitForIdle(...)`, `sendMessage(...)`, `sendPromptFile(...)`, `readLogs(...)`, `listSessions(...)`, `deleteAgent(...)`
  - `src/adapters/paseo-opencode/paseo-log-text.ts`
    - `extractAssistantTextFromLogs(rawLogs, echoedPrompt?)`
    - `stripEchoedPromptPrefix(lines, echoedPrompt?)`
  - `src/adapters/paseo-opencode/paseo-prompts.ts`
    - `buildLeadPrompt(...)`
    - `buildWorkerPrompt(...)`
  - Keep `PaseoOpenCodeAdapter` as the stable public façade.
- Acceptance: file size targets, test coverage to preserve, behavioral invariants
  - Split the current responsibilities at `177-335`, `368-497`, `505-711`, and `713-807` into dedicated modules.
  - Reduce `src/adapters/paseo-opencode/paseo-opencode-adapter.ts` below ~450 lines.
  - Preserve callback identity generation, raw payload refs, and env injection.
- Verification: targeted tests + full pnpm test gate
  - `pnpm test -- tests/paseo-opencode-adapter.test.ts tests/paseo-opencode-adapter-callbacks.test.ts tests/live-smoke-classification.test.ts`
  - `pnpm test`
- Estimated effort: M

### Phase R6 — Evidence pipeline namespace split behind a stable barrel
- Maps to umbrella plan phase: orthogonal
- Scope (files in / files out)
  - In: `src/orchestrator/evidence.ts`, new `src/orchestrator/evidence/*`
  - Out: evidence schema changes, new evidence formats, changes to callers’ import paths
- Concrete extraction targets (new modules + signatures, new test helpers)
  - `src/orchestrator/evidence/redact.ts`
  - `src/orchestrator/evidence/validate-v0.ts`
  - `src/orchestrator/evidence/generate-v0.ts`
  - `src/orchestrator/evidence/provenance.ts`
  - `src/orchestrator/evidence/render.ts`
  - Keep `src/orchestrator/evidence.ts` as a barrel/façade re-exporting the current API.
- Acceptance: file size targets, test coverage to preserve, behavioral invariants
  - Separate the current responsibility blocks at `29-50`, `53-385`, `477-590`, `592-784`, and `786-865`.
  - Reduce `src/orchestrator/evidence.ts` below ~200 lines.
  - Evidence JSON and Markdown outputs remain unchanged.
- Verification: targeted tests + full pnpm test gate
  - `pnpm test -- tests/evidence.test.ts tests/evidence-redaction.test.ts tests/evidence-validator.test.ts tests/evidence-portable-refs.test.ts tests/evidence-catalog-provenance.test.ts`
  - `pnpm test`
- Estimated effort: M

### Phase R7 — Four-layer loader and workspace bootstrap decomposition
- Maps to umbrella plan phase: orthogonal
- Scope (files in / files out)
  - In: `src/four-layer/loader.ts`, `src/bootstrap/workspace-bootstrap.ts`, related CLI/tests
  - Out: new authored schema fields, runtime-helper changes, bootstrap behavior changes
- Concrete extraction targets (new modules + signatures, new test helpers)
  - Loader:
    - `src/four-layer/yaml-lite.ts` for `parseYaml` and parser helpers now in `326-339` and `965-1200`
    - `src/four-layer/authored-validate.ts` for validators now in `149-324` and `823-964`
    - `src/four-layer/authored-normalize.ts` for normalization now in `404-677`
    - `src/four-layer/selection-resolver.ts` for selection/overlay/ref resolution now in `120-148` and `679-789`
  - Bootstrap:
    - `src/bootstrap/workspace-bootstrap-orchestrator.ts` for `ensure/resume/reset` flow now in `148-387`
    - `src/bootstrap/workspace-bootstrap-artifact-chain.ts` for `putBlockedBootstrapRecords` and `ensureBootstrapArtifactChain` now in `693-851`
    - `src/bootstrap/workspace-bootstrap-status.ts` for `buildStatusFromState`, `buildStatusFromUnderlyingStores`, and status projection now in `853-1113`
    - `src/bootstrap/workspace-bootstrap-records.ts` for store/ref/session/step/state helpers now in `967-1284`
- Acceptance: file size targets, test coverage to preserve, behavioral invariants
  - Reduce `src/four-layer/loader.ts` below ~250 lines as a façade.
  - Reduce `src/bootstrap/workspace-bootstrap.ts` below ~500 lines as a façade.
  - Preserve `compileRunPackage` behavior, bootstrap records, and CLI outputs exactly.
- Verification: targeted tests + full pnpm test gate
  - `pnpm test -- tests/four-layer-loader-render.test.ts tests/four-layer-contracts.test.ts tests/cli/run.test.ts tests/bootstrap/workspace-bootstrap.test.ts tests/bootstrap/retry-idempotency.test.ts tests/cli/bootstrap-workspace.test.ts tests/cli/bootstrap-status.test.ts`
  - `pnpm test`
- Estimated effort: L

### Phase R8 — Contract schema/validator split without domain reshaping
- Maps to umbrella plan phase: orthogonal
- Scope (files in / files out)
  - In: `src/contracts/portability.ts`, `src/contracts/compliance.ts`, `src/contracts/observability.ts`; optional mechanical follow-through for `publish.ts`, `review.ts`, `integration.ts`, `ops.ts`
  - Out: domain model redesign, new contract versions, import path breakage
- Concrete extraction targets (new modules + signatures, new test helpers)
  - `src/contracts/shared/validation.ts`
  - `src/contracts/portability-schema.ts` + `src/contracts/portability-validate.ts`
  - `src/contracts/compliance-schema.ts` + `src/contracts/compliance-validate.ts`
  - `src/contracts/observability-schema.ts` + `src/contracts/observability-validate.ts`
  - Keep the current top-level files as barrels/façades so callers still import `@/contracts/portability.js`, etc.
- Acceptance: file size targets, test coverage to preserve, behavioral invariants
  - Keep domain namespaces intact; only separate schema declarations from constructors/parsers/validators.
  - Touched façade files should fall below ~200 lines each.
  - Validation results and coercion behavior remain unchanged.
- Verification: targeted tests + full pnpm test gate
  - `pnpm test -- tests/four-layer-contracts.test.ts tests/**/*.test.ts`
  - `pnpm test`
- Estimated effort: M

## Out of scope for this whole refactor pass
- Any behavioral change to orchestration, artifacts, mailbox flow, or evidence semantics
- Retirement of `static_loop` (still reserved for the umbrella plan’s later work)
- Any churn inside `src/orchestrator/runtime-helper.ts` beyond import-path adjustments that a compiler requires
- Mailbox transport changes, `PaseoChatTransport` changes, or paseo chat protocol changes
- New CLI commands, new flags, or output-format redesigns
- New RunPackage fields, authored-schema expansion, or config-model redesign
- Replacing the in-repo YAML parser with a third-party parser
- Re-slicing contract business domains; this pass only separates responsibilities inside the current domains
- Performance tuning unrelated to responsibility split / file-size reduction

## Refusals (binding for any agent executing this plan)
1. No behavioral changes. Any test that was passing must still pass.
2. No new features.
3. Do NOT churn `src/orchestrator/runtime-helper.ts` — it was just hardened in Slice A; only touch if a refactor target literally cannot avoid it.
4. Do NOT modify mailbox transport or paseo chat code (per architecture synthesis: out of scope).
5. Do NOT add feature flags or backwards-compat shims for refactor-internal moves.
6. Each commit must keep `pnpm test` green (binding R7+R8 budgets apply).

## Verification target (whole pass)
- `timeout 1200 pnpm test`: PASS
- `timeout 1200 pnpm smoke:live`: PASS or fixture-captured (R8 still binds)
- LoC of refactored files reduced per Phase targets.
- Public API surface unchanged.

## Notes for the local manager dispatching this plan
- Land `R1` first. It lowers risk for every later source split and gives shared harness helpers to prove no event-shape regressions.
- `R2` can run in parallel with `R1`.
- `R3` must land before `R4`; extract pure/support code before touching async control-plane flow.
- In `R4`, extract one shared `executeDispatchEntry(...)` before moving branches. That is the only sane way to collapse the three worker-launch paths without changing behavior.
- Do not mix `R4` and `R5` in the same commit. Harness/control-plane churn and adapter churn will otherwise blur blame when event-order tests fail.
- `R5` and `R6` are parallel-safe after `R3` if staffing allows.
- `R7` and `R8` should be last. They are broad but lower urgency than the harness split and easier to review once the orchestration core is smaller.
- Prefer façade/barrel files over large import rewrites. The goal is smaller implementation units, not a repo-wide path migration.
- Watch for circular imports when extracting harness helpers; keep extracted modules function-oriented and pass explicit context objects instead of importing the harness back into itself.
- Preserve event emission order. The structured-control-plane and runtime-helper suites are effectively the safety net for this entire pass.
