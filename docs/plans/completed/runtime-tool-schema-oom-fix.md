# Runtime tool schema OOM fix

## Goal

Stop `@pluto/v2-runtime` tool argument schemas from composing large core payload Zod schemas so runtime typecheck/build no longer blow up on the root `pluto:run` path.

## Scope

- Add regression tests around `packages/pluto-v2-runtime/src/tools/pluto-tool-schemas.ts`
- Replace cross-package payload-schema composition with local leaf schemas in that file
- Keep exported runtime tool schema names and behavior stable
- Verify the runtime typecheck/build/test gates called out in the task

## Plan

1. Add failing tests for forbidden payload-schema imports/composition and current tool-args behavior.
2. Run the targeted tests to capture the red state.
3. Replace imported payload-schema composition with local runtime schemas and local actor-ref schemas.
4. Re-run targeted tests, then runtime and repo verification gates.
