# T4-S2 Report

- Branch: `pluto/v2/t4-s2-mcp-server-transport`
- SHA: `30b6705c776d23579b1a9faf1ab0186b4435a4bd`

## Gate Counts

- `gate_typecheck`
  - `@pluto/v2-core`: exit 0
  - `@pluto/v2-runtime`: exit 0
  - root `tsc -p tsconfig.json --noEmit`: exit 0
- `gate_test`
  - `@pluto/v2-core`: 20 files, 196 tests, exit 0
  - `@pluto/v2-runtime`: 20 files, 140 tests, exit 0
  - root: 7 files, 35 tests, exit 0
- `gate_build`
  - `@pluto/v2-core`: exit 0 (`None of the selected packages has a "build" script` from the driver invocation)
  - `@pluto/v2-runtime`: exit 0
- `gate_no_kernel_mutation`: pass
- `gate_no_paseo_mutation`: pass
- `gate_diff_hygiene`: pass
- `gate_no_verbatim_payload_prompts`: pass

Runtime test count increased from 127 to 140 (`+13`), via 10 MCP server transport tests and 3 lease-store tests.

## Lease Binding Choice

- Mechanism: per-request `Pluto-Run-Actor` HTTP header carrying serialized `ActorRef` JSON.
- Reason: the server is Streamable HTTP / JSON-RPC and should stay method-agnostic and stateless. A request header binds actor identity without introducing connection/session affinity, still lets read tools use actor context, and makes mutating-tool lease checks a simple structural compare against the in-memory turn lease.

## Port-Leak Verification

- Approach: start the server on port `0`, capture the actual bound port from `handle.port`, call `shutdown()`, then start a second server on that same fixed port.
- Result: the second server bound successfully on the same port, which demonstrates that `shutdown()` released the listener cleanly.

## Notes

- Bearer auth is enforced for all MCP requests.
- Lease enforcement applies only to mutating tools; read tools still require actor identity but bypass lease ownership checks.
- Handler-originated hard rejections such as `PLUTO_TOOL_LEAD_ONLY` are surfaced as MCP JSON-RPC errors; kernel authority rejections continue to flow through the existing accepted/false tool result payload.

## Open Questions

- No functional blockers remain for S2.
- The build gate transiently rewrote `packages/pluto-v2-core/package.json` and generated `packages/pluto-v2-core/index.js` in the worktree; both artifacts were removed before commit so the pushed diff stayed within the S2 allowlist. That behavior is worth keeping in mind if later slices rely on a clean worktree immediately after `gate_build`.
