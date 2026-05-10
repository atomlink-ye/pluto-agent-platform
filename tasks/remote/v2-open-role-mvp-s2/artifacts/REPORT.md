# T14-S2 REPORT

## Summary

Opened `ActorRole` in `@pluto/v2-core` from a closed enum to a validated string, preserved `ACTOR_ROLE_VALUES` as a back-compat alias to `BUILTIN_ROLES`, widened core policy compilation/authorization so custom role matchers can authorize non-canonical roles, and added the required core coverage for custom-role validation, compilation, authorization, and reducer behavior.

After rebasing onto `main` commit `2f1495f0`, the S2-owned gates are green. Remaining runtime failures are confined to the explicitly out-of-scope T14-Sx Paseo files called out in the prompt: `run-paseo.test.ts`, `task-closeout.test.ts`, `turn-state.test.ts`, and `agentic-tool-loop.test.ts`.

## Files changed

- `packages/pluto-v2-core/src/actor-ref.ts`
- `packages/pluto-v2-core/src/core/team-context.ts`
- `packages/pluto-v2-core/src/core/spec-compiler.ts`
- `packages/pluto-v2-core/src/core/authority.ts`
- `packages/pluto-v2-core/__tests__/core/team-context.test.ts`
- `packages/pluto-v2-core/__tests__/core/spec-compiler.test.ts`
- `packages/pluto-v2-core/__tests__/core/protocol-validator.test.ts`
- `packages/pluto-v2-core/__tests__/core/run-state-reducer.test.ts`
- `packages/pluto-v2-core/__tests__/run-event-schema-rejection.test.ts`

Deviations from the HANDOFF expected file list:

- `packages/pluto-v2-core/src/core/authority.ts` needed a type widening from the closed four-role union to open `ActorRole` so custom-role policy matchers still typecheck and authorize correctly.
- `packages/pluto-v2-core/__tests__/run-event-schema-rejection.test.ts` needed one assertion update from the old closed-enum invariant to the new invalid-format invariant.

## Decisions made

- ActorRoleSchema format
  Chosen format: `^[a-z][a-z0-9_-]*$` with max length `64` via `z.string().max(64).regex(...)`.
  Normalization decision: no trimming or case-folding. Valid roles must already be canonical. This avoids silent identity aliasing and keeps `isActorRole()` safe as a pure guard for runtime callers that validate but do not rewrite user input.
- ActorRole type form
  Kept as a plain string type via `z.infer<typeof ActorRoleSchema>`. This is the smallest change that opens the schema without introducing branded-type plumbing across the kernel.
- ACTOR_ROLE_VALUES handling
  Preserved as a back-compat alias to `BUILTIN_ROLES` so runtime imports keep typechecking without any runtime code change in S2. `BUILTIN_ROLES` is documentation/runtime-UX only and no longer acts as the validation gate.
- Tests added
  Added coverage for custom-role validation in `team-context.test.ts`, custom-role compilation in `spec-compiler.test.ts`, authored custom-role authorization in `protocol-validator.test.ts`, reducer shape preservation for a custom-role actor in `run-state-reducer.test.ts`, and updated schema-rejection coverage to assert invalid-format role rejection rather than closed-enum membership rejection.

## Approaches considered and rejected

- Keep `ActorRole` as a closed string-literal union / `z.enum(...)`
  Rejected because it preserves the core blocker T14-S2 is meant to remove.
- Use `z.string()` with no format validation
  Rejected because it weakens structural enforcement and admits empty / whitespace / malformed identities.
- Trim or lowercase authored roles during compilation
  Rejected because it would silently coerce distinct authored identities into the same `actorKey()` and would diverge from the runtime guard behavior that only validates, not rewrites.
- Delete `ACTOR_ROLE_VALUES` outright in S2
  Rejected because prompt-surveyed runtime consumers still import it and S2 must not take runtime semantic changes.

## Gates / evidence

| Gate | Artifact | Started | Duration | Exit |
|---|---|---|---|---|
| bootstrap | `artifacts/gate-bootstrap.txt` | 2026-05-10T14:18:21+00:00 | 2s | 0 |
| build runtime cli | `artifacts/gate-build.txt` | 2026-05-10T14:34:41+00:00 | 16s | 0 |
| typecheck core | `artifacts/gate-typecheck-core.txt` | 2026-05-10T14:34:57+00:00 | 2s | 0 |
| test core | `artifacts/gate-core-tests.txt` | 2026-05-10T14:35:48+00:00 | 5s | 0 |
| typecheck runtime | `artifacts/gate-typecheck-runtime.txt` | 2026-05-10T14:35:53+00:00 | 18s | 2 |
| test runtime | `artifacts/gate-runtime-tests.txt` | 2026-05-10T14:36:29+00:00 | 15s | 1 |

Key evidence notes:

- `gate-build.txt`, `gate-typecheck-core.txt`, and `gate-core-tests.txt` are green after rebasing onto the `zod` packaging hotfix.
- `gate-typecheck-runtime.txt` fails only in `packages/pluto-v2-runtime/__tests__/adapters/paseo/task-closeout.test.ts` because a test-local `RunState` fixture is missing the `policy` field added by T14-S1. That file is part of the explicitly out-of-scope T14-Sx cascade-rot cleanup.
- `gate-runtime-tests.txt` fails only in the explicitly excluded T14-Sx files: `run-paseo.test.ts`, `task-closeout.test.ts`, `turn-state.test.ts`, and `agentic-tool-loop.test.ts`.

## Stop conditions hit

None. Remaining runtime failures are in the prompt-declared out-of-scope T14-Sx cascade-rot surface, so the slice proceeded to commit with those failures documented.

## Verdict

- Implementation commit: `bd56b56a64572b852e3ca73a2a478d1876ce3746`
- Report commit: `<pending>`
- Branch: `pluto/v2/open-role-mvp-s2-role-string`
- Acceptance: PASS
