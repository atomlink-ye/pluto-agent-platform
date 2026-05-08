# T4-S1 REPORT

- Branch: `pluto/v2/t4-s1-tool-contract`
- HEAD at report generation: `61c60b0`

## Gates

- `pnpm install` ✅
- `pnpm --filter @pluto/v2-core typecheck` ✅
- `pnpm --filter @pluto/v2-runtime typecheck` ✅
- `pnpm exec tsc -p tsconfig.json --noEmit` ✅
- `pnpm --filter @pluto/v2-core test` ✅ `196/196`
- `pnpm --filter @pluto/v2-runtime test` ✅ `124/124`
- `pnpm test` ✅ `35/35`
- `pnpm --filter @pluto/v2-core build` ✅
- `pnpm --filter @pluto/v2-runtime build` ✅

## Design notes

- Implemented the 8-tool surface as pure in-process Zod schemas plus handler factories under `packages/pluto-v2-runtime/src/tools/`.
- Tool arg schemas are derived from v2-core payload schemas via `.pick()`, `.omit()`, and `.extend()`; no v2-core schema changes were needed.
- `pluto_append_mailbox_message` binds `fromActor` from the session and does not advertise it in tool descriptors.
- `pluto_complete_run` is lead-gated in the handler and synthesizes the same manager-owned request shape used by `run-paseo.ts`.
- `pluto_publish_artifact` writes the artifact sidecar only after an accepted `artifact_published` event and only when inline `body` is present.
- `zod-to-json-schema` was not present in `@pluto/v2-runtime`; I hand-rolled the small MCP `inputSchema` shapes instead of adding a dependency.

## Deviations / environment notes

- No production-code scope deviations.
- The environment had `NODE_ENV=production`, so the first `pnpm install` skipped devDependencies and left `@types/js-yaml` unavailable for typecheck. I re-ran install with `CI=true pnpm install --prod=false --force` to satisfy the required gates without changing package manifests.
- The authority-rejection example in the slice prompt names `authority_violation`, but the closed v2-core rejection enum currently returns `actor_not_authorized`; tests assert the kernel-owned value.

## Open questions

- None.
