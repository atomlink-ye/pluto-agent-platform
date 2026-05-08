# T4-S4 Report

- Branch: `pluto/v2/t4-s4-live-smoke-cleanup`
- Implementation head before report commit: `a7d58286b564376542b688d42786532e6c4c1701` (`a7d5828`)
- Captured runId: `run-hello-team-agentic-tool-mock`
- Push status: `BLOCKED` on GitHub auth (`fatal: could not read Username for 'https://github.com': No such device or address`)

## Gates

- `gate_typecheck`: 3/3 passed
- `smoke_live`: 1/1 passed
- `gate_test`: 3/3 passed
- `gate_build`: 2/2 passed
- `gate_no_kernel_mutation`: passed
- `gate_no_parity_fixture_mutation`: passed
- `gate_agentic_text_purged`: passed
- `gate_extract_directive_purged`: passed
- `gate_no_verbatim_payload_prompts`: passed
- `gate_diff_hygiene`: passed

## Diff Stat

- `47 files changed, 1366 insertions(+), 1840 deletions(-)` against `main`
- Major buckets: text-lane code deletion, smoke-live extension, live fixture capture, invariant coverage, doc sync, plan move, CLI shim isolation in tests

## Deleted Symbols And Files

- Deleted file: `packages/pluto-v2-runtime/src/adapters/paseo/paseo-directive.ts`
- Deleted file: `packages/pluto-v2-runtime/src/adapters/paseo/agentic-prompt-builder.ts`
- Deleted file: `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-loop.test.ts`
- Deleted file: `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-prompt-builder.test.ts`
- Deleted file: `packages/pluto-v2-runtime/__tests__/adapters/paseo/paseo-directive.test.ts`
- Deleted fixture dir: `packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-mock/`
- Deleted runtime export: `extractDirective`
- Deleted runtime mode literal: `agentic_text`
- Deleted text-lane parse-repair / multi-fence handling from the active runtime path

## Notes

- `smoke-live.ts` now honors `--spec` and writes `authored-spec.yaml`, `playbook.md`, and `playbook.sha256` for `agentic_tool` captures.
- The live fixture landed under `tests/fixtures/live-smoke/run-hello-team-agentic-tool-mock/` and the manifest `tests/fixtures/live-smoke/agentic-tool-live-runid.txt` points at it.
- Root CLI tests were updated to place package shims under `src/node_modules/@pluto` instead of mutating the workspace package symlinks.

## Open Questions

- Operator must push `pluto/v2/t4-s4-live-smoke-cleanup` locally because sandbox GitHub auth is unavailable.
- Completed plan status lines were set to `Done — main @ c1632b1`, which is the main base recorded for this worktree before local branch commits are pushed and merged.
