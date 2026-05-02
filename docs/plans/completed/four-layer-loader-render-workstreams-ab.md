# Plan: Four-layer loader/render workstreams A+B

## Status

Status: Completed

## Goal

Implement the authored-layer loader/validation flow and canonical role-prompt render pipeline on top of the frozen four-layer contract stub.

## Scope

- Add `src/four-layer/loader.ts` for YAML loading, normalization into the frozen contract surface, schema validation helpers, workspace loading, and cross-reference resolution.
- Add `src/four-layer/render.ts` for canonical prompt stacking.
- Fail closed on knowledge caps and missing authored refs.
- Add focused unit coverage for valid/invalid/missing-ref loader paths plus render ordering and team-lead-only roster/workflow injection.
- Export the new authored-layer helpers from the shared package entrypoint.

## Verification evidence

- Added `src/four-layer/index.ts`, `src/four-layer/loader.ts`, and `src/four-layer/render.ts`.
- Added `tests/four-layer-loader-render.test.ts` and kept `tests/four-layer-contracts.test.ts` green.
- `"/workspace/playbook-first-impl-v1-root/node_modules/.bin/tsc" -p tsconfig.json --noEmit` — pass.
- `"/workspace/playbook-first-impl-v1-root/node_modules/.bin/vitest" run --reporter dot tests/four-layer-contracts.test.ts tests/four-layer-loader-render.test.ts` — pass.
- `"/workspace/playbook-first-impl-v1-root/node_modules/.bin/vitest" run --reporter dot` — pass.
- `"/workspace/playbook-first-impl-v1-root/node_modules/.bin/tsc" -p tsconfig.build.json` — pass.

## Follow-up

- Runtime/harness integration remains for later workstreams; this slice only adds the authored-layer loader and prompt renderer.
