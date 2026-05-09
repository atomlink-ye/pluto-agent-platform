# T6-S1 Report

## Bridge Materialization Design

- `materializeActorBridge` creates `<actorCwd>/.pluto/handoff.json` with `apiUrl`, `bearerToken`, `actorKey`, and `schemaVersion: "1.0"`.
- It writes an executable `<actorCwd>/pluto-tool` wrapper with literal absolute paths baked in.
- The wrapper reads the sibling handoff JSON, exports `PLUTO_RUN_API_URL`, `PLUTO_RUN_TOKEN`, and `PLUTO_RUN_ACTOR`, then `exec`s the repo-local `tsx` entrypoint against `packages/pluto-v2-runtime/src/cli/pluto-tool.ts`.
- The wrapper also passes `--tsconfig <runtimePackageRoot>/tsconfig.json` so `tsx` resolves the runtime package path aliases correctly from an arbitrary actor cwd.
- Because `pluto-tool.ts` executes the source-mapped `@pluto/v2-core` tree, the materializer ensures `packages/pluto-v2-core/node_modules/zod` is linked to the runtime package's installed `zod` dependency before the wrapper is used.

## Path Resolution Strategy

- `resolveActorBridgeDependencyPaths` walks upward from `actor-bridge.ts` until it finds the `@pluto/v2-runtime` `package.json`.
- From that runtime package root it resolves:
  - `runtimeTsconfigPath`: `<runtimePackageRoot>/tsconfig.json`
  - `plutoToolSourcePath`: `<runtimePackageRoot>/src/cli/pluto-tool.ts`
  - `tsxBinPath`: `<repoRoot>/node_modules/.bin/tsx`
- `prepareAgentInjection` now resolves those paths once per actor spawn and materializes the bridge immediately after creating the actor cwd.

## Test Cases

- `actor-bridge.test.ts` verifies the handoff JSON contents.
- `actor-bridge.test.ts` verifies the wrapper executable bit is set.
- `actor-bridge.test.ts` starts a child HTTP server, runs `<wrapperPath> read-state` via `spawnSync` with `env: {}`, and asserts a sane PromptView JSON response.

## Gates

- `pnpm install`: pass (`gate-bootstrap.txt`, exit 0)
- `pnpm --filter @pluto/v2-runtime typecheck`: pass (`gate-typecheck-runtime.txt`, exit 0)
- `pnpm exec tsc -p tsconfig.json --noEmit`: pass (`gate-typecheck-root.txt`, exit 0)
- `pnpm --filter @pluto/v2-runtime test`: pass (`gate-test-runtime.txt`, 184 passed / 186 total, 2 skipped, exit 0)
- `pnpm test`: failed (`gate-test-root.txt`, 27 passed / 37 total, 10 failed, exit 1)
  - Failure mode: root CLI tests are currently hitting a repo-level `zod` / `tsx` resolution problem outside the T6-S1 allowlist, with stderr like `The requested module 'zod' does not provide an export named 'z'`.
- `gate_no_kernel_mutation`: pass
- `gate_no_predecessor_mutation`: pass
- `gate_diff_hygiene`: pass
- `gate_no_verbatim_payload_prompts`: failed on existing fixture transcripts under `tests/fixtures/live-smoke/029db445-aa2b-406e-ad16-fde7fb45e51d/...`, outside the T6-S1 allowlist

## Diff Hygiene

- Intended tracked source diff stays within the allowlist:
  - `packages/pluto-v2-runtime/src/adapters/paseo/actor-bridge.ts`
  - `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
  - `packages/pluto-v2-runtime/__tests__/adapters/paseo/actor-bridge.test.ts`
  - `tasks/remote/pluto-v2-t6-s1-actor-bridge-20260509/artifacts/REPORT.md`
- The worktree also contains a pre-existing `pnpm-lock.yaml` modification, which was left untouched and should not be staged for this task.

## Push

- `git push origin pluto/v2/t6-s1-actor-bridge`: failed
- Failure mode: `fatal: could not read Username for 'https://github.com': No such device or address`
- Local HEAD after the task commit sequence: `bb8180f` before this report update

## Fix-up commit (prompt integration)

- Objection summary: the actor bridge wrapper was materialized at `<actorCwd>/pluto-tool`, but the bootstrap prompt still claimed bare `pluto-tool` was available in shell, and `run-paseo.ts` built that prompt before `prepareAgentInjection()` produced the wrapper path.
- Scope note: this folds the planned T6-S2 prompt work into T6-S1 because the bridge is not shippable without the prompt citing the real wrapper path.

### Changes by file

- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
  - Reordered first-spawn setup so `prepareAgentInjection()` runs before `buildAgenticToolPrompt()`.
  - Passed the exact `injection.wrapperPath` into the bootstrap prompt builder.
  - Tightened `AgentInjection` so `cwd` and `wrapperPath` are required on the returned object.
- `packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts`
  - Added required `wrapperPath` plumbing on the bootstrap prompt input.
  - Replaced fictional bare `pluto-tool` bootstrap invocation guidance with the exact absolute wrapper path returned by bridge materialization.
  - Updated CLI examples and the post-mutation wait guidance to use that exact wrapper path.
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-prompt-builder.test.ts`
  - Added a `wrapperPath` fixture.
  - Asserted the bootstrap prompt contains the wrapper path and no longer claims `pluto-tool` is available in shell.
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/wakeup-prompt-builder.test.ts`
  - Threaded the new bootstrap-only `wrapperPath` input through the shared prompt-builder helper setup.

### Final gates

- `pnpm install`: pass
- `pnpm --filter @pluto/v2-runtime typecheck`: pass (0 new errors)
- `pnpm exec tsc -p tsconfig.json --noEmit`: pass (0 new errors)
- `pnpm --filter @pluto/v2-runtime exec vitest run __tests__/adapters/paseo/actor-bridge.test.ts`: pass (3/3)
- `pnpm --filter @pluto/v2-runtime test`: pass (184 passed / 186 total, 2 skipped)
- `pnpm test`: pass (37 passed / 37 total)
- Forbidden prompt phrase grep on touched scope (`must match exactly` / `payload must match exactly`): clean
