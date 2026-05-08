# Pluto v2 T4-D0 — MCP injection proof report

## Branch / push state

- Branch: `pluto/v2/t4-d0-mcp-injection-proof`
- Code-fix push SHA: `e90dafd`
- Target remote: `origin/pluto/v2/t4-d0-mcp-injection-proof`
- Branch note: the branch later advanced with this artifact-only report commit.

## Method that worked

- Working method: **temp `opencode.json` in actor `cwd`**
- Partial method: **`OPENCODE_CONFIG_CONTENT` env** reached MCP discovery but did not issue `tools/call`

## Smoke summary block

```text
T4-D0 RESULT
method: tempfile
server.toolCalled: true
agent transcript saw DONE: false
recommendation: Adopt temp opencode.json in actor cwd for T4-S2 and keep env injection as a best-effort fallback.
```

## Gate results

- `pnpm install`: pass after rerunning with `NODE_ENV=development pnpm install --force` (plain install inherited `NODE_ENV=production` and skipped devDependencies)
- `pnpm --filter @pluto/v2-runtime typecheck`: **pass** (1 command, 0 failures)
- `pnpm --filter @pluto/v2-runtime test`: **pass** (16 test files passed, 107 tests passed, 0 failed)
- `pnpm --filter @pluto/v2-runtime smoke:mcp-injection`: **pass** on final run (`env` timed out after `tools/list`; fallback `tempfile` produced `tools/call`)

## Reviewer notes

- The proof is keyed to server-observed `tools/call`, not transcript text. The transcript never showed a final `DONE`, but the fallback method still satisfied the slice because the localhost MCP server recorded `pluto_read_state` exactly once.
- Env injection is still useful evidence: it reached `initialize`, `notifications/initialized`, and `tools/list`, so config delivery itself is not the blocker on that path.

## Open questions

1. Should T4-S2 treat temp `opencode.json` in actor `cwd` as the default production injection path immediately, with env injection kept only as a diagnostic fallback?
2. Is the env-path gap after `tools/list` worth a separate Paseo/OpenCode follow-up, or is the temp-file proof sufficient to unblock T4-S2 without more investigation now?
