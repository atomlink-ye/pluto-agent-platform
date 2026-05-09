# T9-S1b Report

## Summary

T9-S1b shipped per-actor bearer-token binding for the actor-facing local API path. `run-paseo.ts` now precomputes a token registry for all declared actors at run start, writes each non-manager actor's own token into its `handoff.json`, and injects the matching token into that actor's runtime environment when a session is spawned.

`pluto-local-api.ts` no longer trusts a single run-wide bearer token. It now looks up the claimed actor from `Pluto-Run-Actor`, validates that the presented bearer token belongs to that same actor, and returns HTTP `403` with `actor_mismatch` when a valid token is replayed under a different actor header.

The CLI source did not need a behavior change. Existing handoff/env threading already carried the token; once each actor received a different token, the existing CLI path continued to work unchanged.

## What changed

- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
  Replaced the single run-wide local-API token with a preseeded `Map<actorKey, token>`, kept MCP on its own separate token, and threaded per-actor tokens into handoff/env setup for every declared actor at run start.
- `packages/pluto-v2-runtime/src/api/pluto-local-api.ts`
  Changed local API config to accept `tokenByActor`, added bearer parsing plus reverse token lookup, and fail-closed with `403 actor_mismatch` when token/header binding diverges.
- `packages/pluto-v2-runtime/__tests__/api/pluto-local-api.actor.test.ts`
  Added explicit actor-mismatch coverage and switched the suite to actor-specific test tokens.
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/run-paseo.test.ts`
  Added an agentic setup test that verifies distinct handoff tokens are precomputed for all declared actors, including a never-active actor.
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/actor-bridge.test.ts`
  Extended the shared run-binary test to assert that different actors receive different handoff tokens.
- `packages/pluto-v2-runtime/__tests__/api/pluto-local-api.test.ts`
  Updated API smoke coverage to use actor-bound tokens across shorthand and JSON actor headers.
- `packages/pluto-v2-runtime/__tests__/api/pluto-local-api.wait.test.ts`
  Updated wait-route coverage to use actor-bound tokens and kept the auth-failure case intact.
- `packages/pluto-v2-runtime/__tests__/api/composite-tools.test.ts`
  Updated composite-route coverage to use per-actor tokens.
- `packages/pluto-v2-runtime/__tests__/cli/pluto-tool.test.ts`
  Updated subprocess/in-process CLI coverage so generator-specific commands use the generator token while lead commands keep the lead token.
- `packages/pluto-v2-runtime/__tests__/cli/pluto-tool.wait.test.ts`
  Updated wait CLI coverage to use the lead actor's bound token.
- `tasks/remote/pluto-v2-t9-s1b-token-actor-binding-20260509/artifacts/REPORT.md`
  Added this implementation report.

## Decisions made

- **Config shape (Map vs function)**: chose `Map` because `run-paseo.ts` already has the full declared-actor set at startup and the API needs both forward lookup (`claimed actor -> token`) and reverse lookup (`token -> bound actor`) to produce `actor_mismatch` responses cleanly.
- **Error response shape**: chose HTTP `403` with `{ error: { code: "actor_mismatch", detail: "token bound to <bound>, request claimed <claimed>" } }` so the failure is explicit and fail-closed, matching the prompt's test-friendly contract.
- **Auth scope**: enforced token/header binding whenever an actor header is present, not only on mutating routes, because read-state and wait are also actor-scoped surfaces and the same cryptographic binding should hold there.
- **MCP isolation**: kept the MCP server on its own separate token instead of reusing actor tokens, because T9-S1b is scoped to the actor-facing local API path and should not widen into the MCP surface.
- **CLI handling**: left `pluto-tool.ts` unchanged because the existing handoff/env plumbing already reads `PLUTO_RUN_TOKEN`; once the handoff carries the actor-specific token, the CLI path remains valid with no source edit.

## Approaches considered and rejected

- **Function-shaped token registry (`tokenForActor`)**
  Rejected because it would still require scanning actor keys to identify the bound actor for mismatch reporting. The `Map` form made both directions explicit and kept the local API wiring simpler.
- **Keeping one local-API bearer token and only changing handoff metadata**
  Rejected because it would not actually close the replay gap described in the prompt: a shared token would still authenticate cross-actor header forgery.
- **Exporting a token-registry helper just for tests**
  Rejected because it would broaden the runtime surface for a test-only need. The shipped tests verify the behavior through real handoff files, env injection, and live local-API requests instead.
- **Changing CLI source to add token-selection logic**
  Rejected because the token is already supplied by handoff/env. The problem was issuance/binding, not CLI parsing or request construction.

## Stop conditions hit

- none

## Gates

- Focused validation: `pnpm --filter @pluto/v2-runtime exec vitest run __tests__/api/pluto-local-api.actor.test.ts __tests__/api/pluto-local-api.test.ts __tests__/api/pluto-local-api.wait.test.ts __tests__/api/composite-tools.test.ts __tests__/cli/pluto-tool.test.ts __tests__/cli/pluto-tool.wait.test.ts __tests__/adapters/paseo/actor-bridge.test.ts __tests__/adapters/paseo/run-paseo.test.ts`
  Result: pass (`42/42`).
- `pnpm --filter @pluto/v2-runtime typecheck:src`
  Result: fail (`exit 2`) with pre-existing `TS6059` split-config/rootDir errors pulling `packages/pluto-v2-core/src/**` into the runtime src program. No slice-local diagnostics were reported in touched files.
- `pnpm --filter @pluto/v2-runtime typecheck:test`
  Result: fail (`exit 134`) with fatal heap OOM. Per T9-S4 discipline, recorded once and not retried with a larger heap.
- `pnpm exec tsc -p tsconfig.json --noEmit`
  Result: fail with fatal heap OOM / `SIGABRT`. Per T9-S4 discipline, recorded once and not retried with alternate heap settings or direct `./node_modules/.bin/tsc` entrypoints.
- `pnpm --filter @pluto/v2-runtime test`
  Result: pass (`244` passed, `2` skipped).
- `pnpm test`
  Result: pass (`37/37`).
- `gate_no_kernel_mutation`
  Result: pass.
- `gate_no_predecessor_mutation`
  Result: pass.
- `gate_no_verbatim_payload_prompts`
  Result: pass.
- `gate_diff_hygiene`
  Result: pass.

## Verdict

```text
T9-S1b COMPLETE
config-shape: Map
mismatch-status: 403
mismatch-error-code: actor_mismatch
all-actors-tracked-at-start: yes
new tests: 2
typecheck-new-errors: 0
runtime-tests: 244/246
root-tests: 37/37
push: failed
stop-condition-hit: none
```
