# T4-D0 MCP injection discovery

- Date: 2026-05-08
- Slice: T4-D0 — MCP injection proof

## Outcome

- Working method: **B — temp `opencode.json` in actor `cwd`**
- Partial method: **A — `OPENCODE_CONFIG_CONTENT` env** reached MCP discovery (`initialize`, `notifications/initialized`, `tools/list`) but did **not** produce `tools/call`
- Acceptance status: **met via fallback** (`tools/call` observed once with the temp-file method)

## Accepted config payload

The proof script used the same payload for both injection methods. For env injection, Pluto passed `JSON.stringify(...)` of this object as `OPENCODE_CONFIG_CONTENT`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "pluto": {
      "type": "remote",
      "url": "http://127.0.0.1:<PORT>/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer <RUN_TOKEN>"
      }
    }
  }
}
```

## Observed behavior

### Method A — env injection

- `makePaseoCliClient(...).spawnAgent({ env: { OPENCODE_CONFIG_CONTENT: ... } })` delivered the MCP config far enough for the spawned OpenCode actor to contact the localhost server.
- Server saw:
  - `initialize`
  - `notifications/initialized`
  - `tools/list`
- Server did **not** see `tools/call`.
- Transcript evidence showed the actor noticed a configured Pluto MCP route, then replied `BLOCKED` instead of invoking `pluto_read_state`.

Interpretation: env injection is **good enough for config delivery and MCP discovery**, but not reliable enough for the end-to-end proof required by T4-D0.

### Method B — temp file fallback

- Writing the same payload to `opencode.json` inside a temp actor `cwd` succeeded.
- Server saw:
  - `initialize`
  - `notifications/initialized`
  - `tools/list`
  - `tools/call`
- `pluto_read_state` was called exactly once.
- The transcript did not surface a final `DONE` line, but the server-side `toolCalled = true` flag satisfied the proof goal.

Interpretation: temp-file injection is the first method that produced an actual MCP tool invocation from a Paseo-spawned OpenCode actor.

## Quirks

- A successful MCP proof should key off **server-observed `tools/call`**, not transcript text alone. Earlier transcript-based `DONE` detection was a false positive because the prompt itself contained the word `DONE`.
- Env injection was not a total miss: it reached authenticated MCP discovery on localhost, which narrows the problem from “config never arrived” to “tool invocation did not happen under this path”.
- The temp-file path was more reliable than env injection in detached Paseo-spawned sessions for this slice.

## Recommendation for T4-S2

- **Adopt temp `opencode.json` in the actor `cwd` as the primary injection method.**
- Keep **`OPENCODE_CONFIG_CONTENT` env injection as a best-effort fallback / diagnostic path only** unless later evidence shows stable tool invocation under detached Paseo spawn.
- Preserve the server-side proof pattern from this slice: bearer auth, localhost bind, and success keyed to observed `tools/call`.

## Stop-condition assessment

- The hard stop condition (“neither injection method works”) was **not** triggered.
- Env injection only partially worked; temp-file injection completed the required proof.
- No Paseo CLI source changes or v2-core schema changes were required.
