# T5-S4 Report

## Default Mode Flip

- `src/cli/v2-cli-bridge.ts` now defaults `PASEO_MODE` to `orchestrator`.
- The `PASEO_MODE` env override still wins.
- The CLI wrapper now retries the same spawn in `build` mode when the first `orchestrator` launch is rejected with a mode-related error, and logs `paseo_mode_fallback: ...` to stderr.

## Initiating Actor Audit

- Capture point: `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts` records the actor that submitted the accepted `pluto_complete_run` tool call before the loop exits.
- Manager budget failures record `{ kind: 'manager' }`.
- Propagation path:
  - `run-paseo.ts` passes `initiatingActor` into `assembleEvidencePacket(...)`.
  - `packages/pluto-v2-runtime/src/evidence/evidence-packet.ts` carries the runtime-only audit field.
  - `packages/pluto-v2-runtime/src/evidence/final-report-builder.ts` renders `- Initiated by: ...`.
  - `src/cli/v2-cli-bridge.ts` includes the field in both success and failed artifact writing paths.

## Tests

- Modified runtime assertions:
  - lead-initiated close keeps `run_completed.actor = manager` and records `evidencePacket.initiatingActor = role:lead`
  - manager-initiated budget close records `evidencePacket.initiatingActor = manager`
- New CLI cases:
  - default spawn mode is `orchestrator`
  - `PASEO_MODE=build` override is honored
  - `orchestrator` rejection falls back to `build` with a warning
- End-to-end CLI audit check:
  - agentic final report contains `Initiated by: lead (role)`

## Gates

- `pnpm install`: pass
- `pnpm --filter @pluto/v2-runtime test`: pass, `181 passed / 183 total` (`2 skipped`)
- `pnpm test`: pass, `37 passed / 37 total`
- `pnpm --filter @pluto/v2-runtime typecheck`: blocked by Node/TypeScript OOM in this worktree even with `NODE_OPTIONS=--max-old-space-size=4096`
- `pnpm exec tsc -p tsconfig.json --noEmit`: blocked by the same OOM when run directly with 4 GB heap
- `pnpm --filter @pluto/v2-runtime build`: blocked by the same OOM with 4 GB heap
- `gate_no_kernel_mutation`: pass
- `gate_no_predecessor_mutation`: pass
- `gate_no_kernel_event_schema_mutation`: pass
- `gate_diff_hygiene`: pass
- `gate_no_verbatim_payload_prompts`: fails on pre-existing retained live-smoke transcript fixtures outside the S4 allowlist

## Diff Hygiene

- Tracked S4 changes stay within the requested CLI/runtime evidence/test/docs/task-artifact surfaces.
- No `packages/pluto-v2-core/**` tracked file changes.
- No kernel `run_completed` schema changes.
