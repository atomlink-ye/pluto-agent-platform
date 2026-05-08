# T5-S2b Report

## Summary

- Added `WaitRegistry` with atomic cursor-check plus park, single-flight replacement, timeout, and cancellation handling.
- Added `POST /v1/tools/wait-for-event`, `pluto-tool wait`, and MCP parity via `pluto_wait_for_event`.
- Wired the Paseo agentic loop for dual-mode delivery: busy in-flight wait sessions resume without fallback prompts, while non-waiting actors still receive S2a wakeup prompts.
- Added runtime-local wait traces: `wait_armed`, `wait_unblocked`, `wait_timed_out`, and `wait_cancelled`.

## Files

- New: `packages/pluto-v2-runtime/src/api/wait-registry.ts`
- Modified: `packages/pluto-v2-runtime/src/api/pluto-local-api.ts`
- Modified: `packages/pluto-v2-runtime/src/mcp/pluto-mcp-server.ts`
- Modified: `packages/pluto-v2-runtime/src/cli/pluto-tool.ts`
- Modified: `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
- Modified: `packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts`
- New: `packages/pluto-v2-runtime/__tests__/api/wait-registry.test.ts`
- New: `packages/pluto-v2-runtime/__tests__/api/pluto-local-api.wait.test.ts`
- New: `packages/pluto-v2-runtime/__tests__/cli/pluto-tool.wait.test.ts`
- New: `packages/pluto-v2-runtime/__tests__/mcp/pluto-mcp-server.wait.test.ts`
- Modified: `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts`
- Modified: `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-prompt-builder.test.ts`
- Modified: `packages/pluto-v2-runtime/__tests__/cli/pluto-tool.test.ts`
- Modified: `packages/pluto-v2-runtime/__tests__/mcp/pluto-mcp-server.test.ts`

## Tests

- Added 15 runtime tests across the new wait registry, local API wait route, CLI wait command, MCP wait parity, and driver dual-mode flow.
- Updated existing prompt-builder, CLI, MCP, and agentic-loop tests for the new wait surface.

## Gates

- `pnpm install`: passed
- `gate_typecheck`: passed
- `gate_test`: passed
- `gate_build`: passed
- `gate_no_kernel_mutation`: passed
- `gate_no_predecessor_mutation`: passed
- `gate_no_verbatim_payload_prompts`: passed
- `gate_diff_hygiene`: passed

## Notes

- Local `tsx` subprocess execution required a non-committed workspace resolution shim at `packages/node_modules/zod -> ../pluto-v2-runtime/node_modules/zod` so direct source imports from `packages/pluto-v2-core/src/**` could resolve `zod`. This was an environment-only assist for local gate execution and is not part of the git diff.

## Push

- Code commit created: `61a6d17` (`feat(v2): T5-S2b wait registry + dual-mode delivery`)
- `git push origin pluto/v2/t5-s2b-wait-registry` failed on auth: `fatal: could not read Username for 'https://github.com': No such device or address`
