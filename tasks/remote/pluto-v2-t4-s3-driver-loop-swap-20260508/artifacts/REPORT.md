# T4-S3 Report

## Status

- Slice: `pluto-v2-t4-s3-driver-loop-swap`
- Branch: `pluto/v2/t4-s3-driver-loop-swap`
- Code commit created locally: `0a90973`
- Branch push status: auth failed
- Push failure: `fatal: could not read Username for 'https://github.com': No such device or address`
- Operator action: push the branch locally after auth is available

## Scope Delivered

- Added runtime-local orchestration modes `agentic_tool` and `agentic_text`, with legacy `agentic` normalized to `agentic_text` at load time while preserving the closed v2-core schema.
- Added a new tool-driven Paseo lane in `run-paseo.ts` that starts the in-process Pluto MCP server, injects per-actor `opencode.json` under `.pluto/runs/<runId>/agents/<actorKey>/`, uses the live tool handlers and lease store, and cleans up the per-actor cwd plus MCP server in `finally`.
- Added `agentic-tool-prompt-builder.ts` with the lead-only `Never delegate understanding` framing, PromptView serialization, role-sliced playbook handling, tool listing, and no fenced-JSON directive contract.
- Added `agentic_tool` loop coverage and prompt-builder coverage, and updated the existing text-lane fixture/tests to use `agentic_text`.
- Added the new mock fixture `packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-tool-mock/`.

## Validation

- `bash tasks/remote/pluto-v2-t4-s3-driver-loop-swap-20260508/commands.sh gate_typecheck`
- `bash tasks/remote/pluto-v2-t4-s3-driver-loop-swap-20260508/commands.sh gate_test`
- `bash tasks/remote/pluto-v2-t4-s3-driver-loop-swap-20260508/commands.sh gate_build`
- `bash tasks/remote/pluto-v2-t4-s3-driver-loop-swap-20260508/commands.sh gate_no_kernel_mutation`
- `bash tasks/remote/pluto-v2-t4-s3-driver-loop-swap-20260508/commands.sh gate_no_tools_mutation`
- `bash tasks/remote/pluto-v2-t4-s3-driver-loop-swap-20260508/commands.sh gate_no_smoke_live_or_parity_mutation`
- `bash tasks/remote/pluto-v2-t4-s3-driver-loop-swap-20260508/commands.sh gate_diff_hygiene`
- `bash tasks/remote/pluto-v2-t4-s3-driver-loop-swap-20260508/commands.sh gate_no_verbatim_payload_prompts`
- Additional targeted verification during implementation:
- `pnpm --filter @pluto/v2-runtime typecheck`
- `pnpm --filter @pluto/v2-runtime test`

## Notes

- `extractDirective` is not used in the `agentic_tool` lane; coverage asserts that path stays out of the call graph.
- The primary MCP injection path is the per-actor temp `opencode.json`; `OPENCODE_CONFIG_CONTENT` remains a fallback only if that file path cannot be created.
- The branch still needs a successful authenticated `git push`, and the report force-add commit below will need the same operator-side push if auth remains unavailable.

## Fix-up addendum

- Summary: the lease store now tracks per-turn mutation consumption, the MCP server consumes that lease on the first mutating tool call, and later mutating calls in the same lease are rejected with `PLUTO_TURN_CONSUMED` before any handler or kernel mutation runs. Read tools remain unrestricted.
- Files touched in this fix-up:
  - `packages/pluto-v2-runtime/src/mcp/turn-lease.ts`
  - `packages/pluto-v2-runtime/src/mcp/pluto-mcp-server.ts`
  - `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
  - `packages/pluto-v2-runtime/__tests__/mcp/turn-lease.test.ts`
  - `packages/pluto-v2-runtime/__tests__/mcp/pluto-mcp-server.test.ts`
  - `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts`
  - `tasks/remote/pluto-v2-t4-s3-driver-loop-swap-20260508/artifacts/REPORT.md`
- Fix commit SHA: `24ca456`
- Final branch SHA: recorded after the follow-up docs commit and push in the operator handoff/final response.
- Test count delta: `+5` runtime tests (`turn-lease` +3, `pluto-mcp-server` +1, `agentic-tool-loop` +1).
- Gates:
  - Passed: `pnpm --filter @pluto/v2-core typecheck`
  - Passed: `pnpm --filter @pluto/v2-runtime typecheck`
  - Passed: `pnpm --filter @pluto/v2-runtime test -- turn-lease.test.ts pluto-mcp-server.test.ts agentic-tool-loop.test.ts agentic-tool-prompt-builder.test.ts`
  - Passed: `pnpm --filter @pluto/v2-runtime test`
  - Passed: `pnpm test`
  - Passed: `pnpm --filter @pluto/v2-runtime build`
  - Pre-existing out-of-scope failure remains: `pnpm exec tsc -p tsconfig.json --noEmit` at `src/cli/v2-cli-bridge.ts:416` (`LoadedAuthoredSpec` vs `AuthoredSpec` assignment on the branch as checked out; no runtime-package file in the allowed edit set owns that root typing mismatch).
