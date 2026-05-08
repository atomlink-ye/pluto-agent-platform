# Pluto v2 T1 — acceptance fix-up report

## Sandbox / commit+push state

- Execution environment: local worktree at `/Volumes/AgentsWorkspace/orgs/atomlink-ye/code/pluto-agent-platform`
- Branch: `pluto/v2/t1-spec-prompt-view-runtdir`
- Target remote: `origin/pluto/v2/t1-spec-prompt-view-runtdir`
- Pushed commit: `ac0aa552e46a2350f8199609f9bf8d79c13cf90c`
- Push verification: local `HEAD` matches `origin/pluto/v2/t1-spec-prompt-view-runtdir`
- Local note: unrelated untracked workspace files remain outside the scoped T1 slice

## Scope per deliverable

1. Loader/playbook metadata: populated typed loader metadata for resolved playbooks and switched YAML parsing to typed numeric/boolean schema handling.
2. Prompt view: removed cast-only `playbookSha256` usage and consumed loader-backed playbook metadata.
3. CLI run-directory parity: fixed workspace-default run-root derivation and made run-directory artifact writing run on both success and failure paths.
4. Tests: added loader assertions for numeric orchestration fields and explicit lead/manager kind checks; added prompt-view resolver-backed playbook test; strengthened CLI run-directory assertions and added failure-path coverage.
5. Bundle acceptance/docs: updated `acceptance.md` diff-hygiene allow-list to include the evidence helper files and modified test files in scope.

## Closure proofs

- Fix 1: loader now resolves playbook metadata into typed loader output (`playbook.ref`, `playbook.body`, `playbook.sha256`), and prompt-view reads `spec.playbook` instead of cast-only metadata.
- Fix 2: `src/cli/run.ts` now defaults `runRootDir` to `<workspace>/.pluto/runs` when `--workspace` is set without `--data-dir`.
- Fix 3: `src/cli/v2-cli-bridge.ts` now writes run-directory artifacts on both success and failure paths, with best-effort logging that does not replace the original bridge failure.
- Fix 4: authored-spec YAML parsing now uses typed YAML schema handling, and loader tests cover numeric orchestration fields plus explicit lead/manager kind rejections.
- Fix 5: CLI gate-6 assertions now require non-empty files via `stat().size > 0`.
- Fix 6: bundle `acceptance.md` now includes the missing evidence helper files and reconciles the modified test-file subset.
- Fix 7: bundle closure artifacts are regenerated locally under `artifacts/`, including this report and fresh gate logs.

## Grep / boundary results

- Kernel surface boundary gate: `artifacts/gate-no-kernel-mutation.txt`
- Paseo adapter boundary gate: `artifacts/gate-no-paseo-adapter-mutation.txt`
- Smoke-live boundary gate: `artifacts/gate-no-smoke-live-mutation.txt`
- S4 parity fixture boundary gate: `artifacts/gate-no-parity-fixture-mutation.txt`

## Files changed

- Code/tests touched for this fix-up:
  - `packages/pluto-v2-runtime/src/loader/authored-spec-loader.ts`
  - `packages/pluto-v2-runtime/src/adapters/paseo/prompt-view.ts`
  - `packages/pluto-v2-runtime/__tests__/loader/authored-spec-loader.test.ts`
  - `packages/pluto-v2-runtime/__tests__/adapters/paseo/prompt-view.test.ts`
  - `src/cli/run.ts`
  - `src/cli/v2-cli-bridge.ts`
  - `tests/cli/run-runtime-v2-default.test.ts`
  - `tasks/remote/pluto-v2-t1-spec-prompt-view-runtdir-20260508/acceptance.md`
- Bundle artifacts touched:
  - `tasks/remote/pluto-v2-t1-spec-prompt-view-runtdir-20260508/artifacts/REPORT.md`
  - `tasks/remote/pluto-v2-t1-spec-prompt-view-runtdir-20260508/artifacts/gate-*.txt`

## Validation gate output paths

- `artifacts/gate-typecheck-core.txt`
- `artifacts/gate-typecheck-runtime.txt`
- `artifacts/gate-typecheck-root.txt`
- `artifacts/gate-test-core.txt`
- `artifacts/gate-test-runtime.txt`
- `artifacts/gate-test-root.txt`
- `artifacts/gate-build-core.txt`
- `artifacts/gate-build-runtime.txt`
- `artifacts/gate-no-kernel-mutation.txt`
- `artifacts/gate-no-paseo-adapter-mutation.txt`
- `artifacts/gate-no-smoke-live-mutation.txt`
- `artifacts/gate-no-parity-fixture-mutation.txt`

## Remote review loop

- Prior acceptance state: `NEEDS_FIX` with 7 objections.
- Independent post-fix oracle review: `READY_TO_MERGE` with no findings.

## Known issues / follow-up watchlist

- Failure-path artifact writing currently synthesizes empty projections when `runPaseo` throws before exposing partial events; this matches the current gates but is worth revisiting if partial-event recovery is later required.
