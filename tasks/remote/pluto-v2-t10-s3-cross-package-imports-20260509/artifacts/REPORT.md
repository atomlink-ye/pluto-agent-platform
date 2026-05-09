# T10-S3 Report

## Summary
T10-S3 removed runtime-side direct imports from `packages/pluto-v2-core/src/**` and routed those call sites through the published `@pluto/v2-core` package surface instead. The scoped code change stayed within the allowlist: one additive re-export in `packages/pluto-v2-core/src/index.ts`, import-line-only updates in the runtime files, and one new lint-style regression test.

The survey in this worktree found the four expected static imports plus one additional dynamic import in `packages/pluto-v2-runtime/scripts/smoke-live.ts`. That fifth site was still a cross-package source leak, so it was included in scope. After cleanup, the fast-path gates passed, `typecheck:src` exited 0, and the runtime source program no longer references `pluto-v2-core/src` directly.

## Survey
- Cross-package src imports found: `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts:21`, `packages/pluto-v2-runtime/src/api/wait-registry.ts:3`, `packages/pluto-v2-runtime/scripts/smoke-live.ts:9`, `packages/pluto-v2-runtime/scripts/smoke-live.ts:318`, `packages/pluto-v2-runtime/scripts/smoke-acceptance.ts:4`
- v2-core public API symbols needing addition: `actorKey`

## What changed
- `packages/pluto-v2-core/src/index.ts`: added `export { actorKey } from './core/team-context.js';` so runtime code can import `actorKey` through `@pluto/v2-core`.
- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`: changed the `actorKey` import to come from `@pluto/v2-core`; no other lines changed.
- `packages/pluto-v2-runtime/src/api/wait-registry.ts`: changed the `actorKey` import to come from `@pluto/v2-core`.
- `packages/pluto-v2-runtime/scripts/smoke-live.ts`: changed both the top-level type import and the dynamic runtime import from `../../pluto-v2-core/src/index.ts` to `@pluto/v2-core`.
- `packages/pluto-v2-runtime/scripts/smoke-acceptance.ts`: changed the `RunEvent` type import to come from `@pluto/v2-core`.
- `packages/pluto-v2-runtime/__tests__/lint/no-cross-package-src.test.ts`: added a regression test that recursively scans runtime `src/` and `scripts/` TypeScript files and fails on direct `pluto-v2-core/src` imports, covering both `from '...'` and `import('...')` forms.

## Decisions made
- **Lint guard mechanism (test vs script)**: chose `A` because the repo-level regression belongs in CI, and the new test can catch both static imports and dynamic `import()` leaks without depending on slice-local shell scripts.
- **v2-core public API additions**: added `actorKey` only, because the other runtime-used symbols in this slice were already reachable from `@pluto/v2-core` and did not require new exports.
- **Additional survey finding in scope**: included `smoke-live.ts:318` because leaving the dynamic import on `../../pluto-v2-core/src/index.ts` would preserve the exact cross-package source boundary leak this slice exists to remove.
- **Bootstrap/install handling**: did not rerun bootstrap or zod-shim restoration because the prompt stated they were already completed; ran the remaining fast-path build, gate, diagnostics, typecheck, and test steps.

## Approaches considered and rejected
- Rejected a script-only grep guard in `commands.sh` because the prompt preferred a test and a shell-only guard would not protect CI unless this slice-specific script were rerun.
- Rejected stopping at the four manager-surveyed static imports because the local survey showed a fifth dynamic source import in `smoke-live.ts`, and leaving it would keep the runtime program coupled to sibling source.
- Rejected broader v2-core surface edits because the prompt limited v2-core changes to additive `index.ts` re-exports, and `actorKey` was the only missing export needed.

## Stop conditions hit
- none

## Measurements
| | T9-S5 baseline | After T10-S3 |
|---|---|---|
| Files | 236 | 232 |
| Types | 36165 | 36228 |
| Memory | 167575K | 159048K |
| typecheck:src exit | OOM-prone | 0 |

`typecheck:src` now passes cleanly in this worktree. Both the manual post-change diagnostics run and the scripted `typecheck:src` gate completed successfully.

## Gates
- Bootstrap/install: pre-completed per prompt; not rerun.
- `gate-build-v2-core.txt`: exit `0` in `8s`.
- `gate-no-verbatim-payload-prompts.txt`: pass.
- `gate-no-cross-package-src-imports.txt`: pass.
- `gate-no-kernel-logic-change.txt`: pass.
- `gate-diff-hygiene.txt`: pass.
- `post-extended-diagnostics.txt`: exit `0`; `Files 232`, `Types 36228`, `Memory used 159048K`.
- `gate-typecheck-runtime-src.txt`: exit `0` in `6s`.
- `gate-typecheck-root.txt`: exit `0` in `7s`.
- `gate-typecheck-runtime-test.txt`: exit `0` in `7s`.
- `gate-test-runtime.txt`: exit `0`; `38/38` files passed, `245 passed | 2 skipped (247)` tests, including the new lint test.
- `gate-test-root.txt`: exit `0`; `7/7` files passed, `37/37` tests.

## Verdict
T10-S3 completed successfully. Runtime cross-package source imports were removed, `actorKey` was exposed through the public v2-core package surface, the new lint test locks the boundary in place, and the fast-path typecheck/test gates passed without triggering any stop condition.
