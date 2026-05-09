# T9-S1 Report

## Scope shipped

- Added explicit CLI actor selection in `packages/pluto-v2-runtime/src/cli/pluto-tool.ts`.
- Materialized one shared run-level binary at `<workspaceCwd>/.pluto/runs/<runId>/bin/pluto-tool`.
- Kept per-actor `pluto-tool` wrappers as backward-compat shims that forward to the shared run binary.
- Tightened local API actor handling with required actor headers for mutating routes and run actor-set membership checks.
- Updated bootstrap prompts to cite the shared run binary and explicit `--actor role:<role>` usage.

## Design choices

### CLI actor handling

- Canonical syntax is `pluto-tool --actor <key> <command> ...`.
- Mutating commands and `read-state` fail closed when neither `--actor` nor `PLUTO_RUN_ACTOR` is present.
- The CLI normalizes actor values to stable keys like `role:lead` and includes the effective actor in JSON output.
- Response wrapping is additive: object responses become `{ actor, ...response }`.

### Shared run binary

- Shared binary path: `<workspaceCwd>/.pluto/runs/<runId>/bin/pluto-tool`.
- The shared wrapper only bakes in `tsx` and the `pluto-tool.ts` entrypoint.
- Actor-local wrappers still read sibling `handoff.json`, export `PLUTO_RUN_API_URL`, `PLUTO_RUN_TOKEN`, and `PLUTO_RUN_ACTOR`, then forward with `--actor "$PLUTO_RUN_ACTOR"`.
- The legacy wrapper keeps the self-check `read-state` fast path intact for bridge validation.

### Local API actor enforcement

- The request actor is sourced from the `Pluto-Run-Actor` header.
- Mutating routes and `read-state` require a usable actor header.
- Missing actor header returns `400` with `missing_actor_header`.
- Actor headers outside the registered run actor set return `403` with `unknown_actor`.
- `read-artifact` and `read-transcript` can still proceed without an actor header because they do not need actor-scoped PromptView resolution.

## Backward compatibility

- Existing actor-local wrapper invocations still work.
- Prompts now teach the shared run binary as the canonical path while explicitly calling out the wrapper shortcut.

## Tests added or expanded

- `packages/pluto-v2-runtime/__tests__/api/pluto-local-api.actor.test.ts`
- `packages/pluto-v2-runtime/__tests__/cli/pluto-tool.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/actor-bridge.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-prompt-builder.test.ts`

New test count: 6

## Token-binding deferral (T9-S1b)

Full token-to-actor binding was not implemented in this slice because `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts:629` still creates a single `bearerToken` per run and shares it across all actor handoffs.

The narrowed alternative shipped here is:

- explicit CLI `--actor` support
- required actor headers on mutating routes
- actor-set membership enforcement against the run's registered actors

T9-S1b must do the following:

- issue one bearer token per actor in `run-paseo`
- maintain a token registry keyed by actor
- validate that `Authorization: Bearer <token>` is bound to the same actor claimed by `Pluto-Run-Actor`
- return an `actor_mismatch` error when the token-bound actor and claimed actor differ

## Gates

- `pnpm install`: passed
- `pnpm --filter @pluto/v2-runtime typecheck`: failed due pre-existing workspace baseline outside this slice (`zod` export/typecheck failures in `packages/pluto-v2-core/**` and existing runtime files)
- `pnpm exec tsc -p tsconfig.json --noEmit`: failed due the same pre-existing workspace baseline
- `pnpm --filter @pluto/v2-runtime test`: passed, `226/228` tests green (`2` skipped)
- `pnpm test`: failed on existing root CLI baseline, `27/37` tests green

## Final state

- token-binding-model: `SHARED-PER-RUN`
- header-enforcement: `missing_actor_header -> 400`, `unknown_actor -> 403`
- backward-compat: `yes`
