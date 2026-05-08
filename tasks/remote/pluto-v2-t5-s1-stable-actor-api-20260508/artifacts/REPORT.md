# T5-S1 Report

## Summary

- Added `packages/pluto-v2-runtime/src/api/pluto-local-api.ts` as a 127.0.0.1 REST wrapper over the existing T4-S1 handler factory via `makePlutoToolHandlers(...)`.
- Added `packages/pluto-v2-runtime/src/cli/pluto-tool.ts` as the stable actor-facing CLI, with env-bound API URL, bearer token, and actor identity.
- Rewired `run-paseo.ts` to start the local API alongside the MCP server, hand off `PLUTO_RUN_API_URL`, `PLUTO_RUN_TOKEN`, and `PLUTO_RUN_ACTOR` through spawned agent env, stop writing `opencode.json`, and root actor/run paths under `args.workspaceCwd`.
- Rewrote the actor tool prompt to teach literal `pluto-tool` invocations and removed raw URL/token guidance from prompt text.

## Validation

- `bash /workspace/tasks/remote/pluto-v2-t5-s1-stable-actor-api-20260508/commands.sh gate_typecheck`
- `bash /workspace/tasks/remote/pluto-v2-t5-s1-stable-actor-api-20260508/commands.sh gate_test`
- `bash /workspace/tasks/remote/pluto-v2-t5-s1-stable-actor-api-20260508/commands.sh gate_build`
- `bash /workspace/tasks/remote/pluto-v2-t5-s1-stable-actor-api-20260508/commands.sh gate_no_kernel_mutation`
- `bash /workspace/tasks/remote/pluto-v2-t5-s1-stable-actor-api-20260508/commands.sh gate_no_predecessor_mutation`
- `bash /workspace/tasks/remote/pluto-v2-t5-s1-stable-actor-api-20260508/commands.sh gate_no_verbatim_payload_prompts`
- `bash /workspace/tasks/remote/pluto-v2-t5-s1-stable-actor-api-20260508/commands.sh gate_no_token_in_prompt_text`
- `bash /workspace/tasks/remote/pluto-v2-t5-s1-stable-actor-api-20260508/commands.sh gate_diff_hygiene`

## Notes

- Added a skipped invariant in `packages/pluto-v2-runtime/__tests__/fixtures/agentic-tool-live-invariants.test.ts` for `pluto-tool` transcript usage. The existing captured fixture still reflects the pre-S1 `curl` discovery path and must be recaptured in the later live rerun slice.

## Push Status

- Commit created locally at `830e834` with message `feat(v2): T5-S1 stable actor API (CLI + HTTP + env handoff)`.
- `commit_and_push` failed at the remote push step with GitHub auth error: `fatal: could not read Username for 'https://github.com': No such device or address`.
- `force_add_report` also created a local report commit, and its push failed with the same auth error.
- Operator push is still required locally.
