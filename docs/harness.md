# docs/harness.md — v2 Control Surface

## Active Surfaces

| Surface | Purpose |
| --- | --- |
| `src/cli/run.ts` | root CLI entrypoint |
| `src/cli/v2-cli-bridge.ts` | bridge into the runtime packages |
| `packages/pluto-v2-core/` | pure contracts, core, projections |
| `packages/pluto-v2-runtime/` | spec loader, adapters, runner, evidence assembly |
| `packages/pluto-v2-runtime/scripts/smoke-live.ts` | retained live smoke harness |

## Supported Invocation

```bash
pnpm pluto:run --spec <path>
```

This is the only supported mainline invocation.

## Runtime Modes

| Mode | Purpose | Active Path |
| --- | --- | --- |
| `deterministic` | byte-stable regression lane | fenced JSON prompts in the deterministic Paseo adapter |
| `agentic_tool` | live agentic lane | `runPaseo()` + in-process Pluto MCP server |

## `agentic_tool` Flow

`agentic_tool` runs keep the kernel in-process and expose a localhost MCP server for the lifetime of a single run.

1. `runPaseo()` loads the authored spec and starts one Pluto MCP server bound to `127.0.0.1:<random>/mcp`.
2. The server exposes the fixed 8-tool surface.
3. Each spawned actor gets an injected `opencode.json` in its per-actor cwd under `.pluto/runs/<runId>/agents/<actorKey>/`.
4. The lead or sub-actor may use read tools freely during a turn.
5. The first accepted mutating Pluto tool call consumes the turn.
6. Turn lease enforcement happens in the MCP server before the kernel submit.
7. Accepted kernel events remain the only replay truth.
8. On completion, the server shuts down and the injected per-actor cwd is cleaned up.

Tool surface:

- Mutating: `pluto_create_task`, `pluto_change_task_state`, `pluto_append_mailbox_message`, `pluto_publish_artifact`, `pluto_complete_run`
- Read-only: `pluto_read_state`, `pluto_read_artifact`, `pluto_read_transcript`

There is no text parser in the `agentic_tool` control plane. Model text is audit output only; state changes happen through validated tool calls.

## Live Smoke Knobs

| Knob | Env Var | Purpose |
| --- | --- | --- |
| Provider | `PASEO_PROVIDER` | paseo provider alias |
| Model | `PASEO_MODEL` | model id |
| Mode | `PASEO_MODE` | paseo launch mode |
| Thinking | `PASEO_THINKING` | optional thinking mode |
| Host | `PASEO_HOST` | explicit daemon host |
| Binary | `PASEO_BIN` | paseo CLI path |
| Repo root | `PLUTO_V2_REPO_ROOT` | override repo root resolution |
| Run id | `PLUTO_V2_SMOKE_RUN_ID` | fixed deterministic smoke run id |
| Wait timeout | `PLUTO_V2_WAIT_TIMEOUT_SEC` | smoke wait timeout |
| Workspace cwd | `PLUTO_V2_WORKSPACE_CWD` | runtime cwd for spawned actors |

`pnpm smoke:live --spec=packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-tool-mock/scenario.yaml` captures the live `agentic_tool` fixture.

## Evidence Surface

- `events.jsonl`
- `evidence-packet.json`
- `usage-summary.json`
- `final-report.md`
- `paseo-transcripts/*.txt`
- `authored-spec.yaml`, `playbook.md`, `playbook.sha256` for `agentic_tool` smoke captures
- retained live-smoke fixtures under `tests/fixtures/live-smoke/`

## Archive Boundary

v1.6 harness docs, command shapes, and authored-config flows are no longer active control surfaces on `main`.
See `docs/design-docs/v1-archive.md` for recovery details.
