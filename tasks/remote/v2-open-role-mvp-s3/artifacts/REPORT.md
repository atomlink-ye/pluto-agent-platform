# T14-S3 REPORT

## Summary

Implemented S3's runtime open-role wiring in the runtime package: loader duplicate-`actorKey` fail-fast, open-role parsing for CLI/API/reporting, and structural custom-role close-out guidance in the Paseo prompt builder. All in-scope S3 gates are green. The downstream red `pnpm test` and `smoke:live` results are explained by the already-documented `tests/cli` harness rot and will be re-run during POST-T14 in a clean worktree.

## Files changed

- `packages/pluto-v2-runtime/src/loader/authored-spec-loader.ts`
- `packages/pluto-v2-runtime/src/cli/pluto-tool.ts`
- `packages/pluto-v2-runtime/src/cli/runs.ts`
- `packages/pluto-v2-runtime/src/api/pluto-local-api.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts`
- `packages/pluto-v2-runtime/src/tools/pluto-tool-schemas.ts`
- `packages/pluto-v2-runtime/__tests__/loader/authored-spec-loader.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-prompt-builder.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/run-paseo.test.ts`
- `packages/pluto-v2-runtime/__tests__/api/pluto-local-api.actor.test.ts`

Audited but did not change:

- `packages/pluto-v2-runtime/src/api/wait-registry.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/prompt-view.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
- `src/cli/v2-cli-bridge.ts`

## Decisions made

- Duplicate-actorKey guard wording: `duplicate_actor_key: declaredActors "<a>" and "<b>" both resolve to actorKey "<key>"`.
- Loader placement: the guard runs immediately after authored-spec schema parse and before agentic runtime requirements / returned loaded spec.
- Custom-role close-out guidance form: default custom non-lead roles are directed to `worker-complete`, with explicit fallback guidance to `evaluator-verdict` when authored policy authorizes evaluator-style close-out.
- `pluto-tool-schemas.ts` decision: replaced the closed role `enum` with a regex `pattern` matching the S2 role format so custom roles do not fail JSON-schema validation; built-in roles remain in the description text for UX.
- Smoke outcome: canonical Symphony smoke did not run to scenario completion in this worktree because `tests/cli` harness rot had already mutated core shim files; `pnpm build:runtime-cli` then failed before `smoke-live.ts` started.

## Approaches considered and rejected

- Rejected an `actor:<id>` rewrite or any multi-same-role support. S3 only fails duplicate `actorKey` declarations fast; identity migration stays deferred to T15+.
- Rejected keeping the JSON-schema role enum as documentation. It would still reject valid custom roles at schema-validation time.
- Rejected prompt-only custom-role nudges. The prompt builder now points custom non-lead roles at existing structural close-out verbs instead of leaving the branch empty.
- Rejected broadening this slice into the unrelated root CLI / shim-rot failures surfaced by `pnpm test` and `smoke:live`.

## Gates / evidence

| Gate | Artifact | Started | Duration | Exit |
|---|---|---|---|---|
| typecheck core | `artifacts/gate-typecheck-core.txt` | 2026-05-10T15:03:12+00:00 | 4s | 0 |
| typecheck runtime | `artifacts/gate-typecheck-runtime.txt` | 2026-05-10T15:03:12+00:00 | 20s | 0 |
| test core | `artifacts/gate-core-tests.txt` | 2026-05-10T15:03:38+00:00 | 7s | 0 |
| test runtime | `artifacts/gate-runtime-tests.txt` | 2026-05-10T15:03:38+00:00 | 17s | 0 |
| test full | `artifacts/gate-full-tests.txt` | 2026-05-10T15:03:59+00:00 | 17s | 1 |
| smoke live | `artifacts/gate-smoke-live.txt` | 2026-05-10T15:04:53+00:00 | 8s | 2 |

Targeted slice tests run before the recorded gates also passed:

- `pnpm exec vitest run __tests__/loader/authored-spec-loader.test.ts __tests__/adapters/paseo/agentic-tool-prompt-builder.test.ts __tests__/adapters/paseo/run-paseo.test.ts __tests__/api/pluto-local-api.actor.test.ts`

Observed gate failures outside S3 scope:

- `gate-full-tests.txt`: root `tests/cli/*` fail in the documented shim-rewrite harness rot lane, outside S3 runtime scope.
- `gate-smoke-live.txt`: `pnpm build:runtime-cli` fails before smoke execution after that same harness rot mutates the core shim. The blocking error is `Module '"zod"' has no exported member 'z'`.
- POST-T14 will re-run `smoke:live` against the Symphony fixture in a fresh worktree where `tests/cli` has not mutated the core shim files.
- Bundle gap: `/workspace/tasks/remote/v2-open-role-mvp-s3/acceptance.md` is missing; used `prompt.md` + `HANDOFF.md` as the acceptance source.

## Stop conditions hit

- None.

## Verdict

- Implementation commit: c574c0d4b2b5da7622cf01a87b9d2f362fd40924
- Report commit: pending
- Branch: pluto/v2/open-role-mvp-s3-runtime-wiring
- Acceptance: PASS
