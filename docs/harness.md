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

`agentic_tool` runs keep the kernel in-process and hand each actor the stable Pluto actor API via env + CLI.

1. `runPaseo()` loads the authored spec and starts one Pluto control server for the lifetime of the run.
2. The server exposes the fixed 8-tool surface.
3. Each spawned actor gets `PLUTO_RUN_API_URL`, `PLUTO_RUN_TOKEN`, and `PLUTO_RUN_ACTOR` injected via Paseo `--env`.
4. Actors should call Pluto through `pluto-tool`; the lead or sub-actor may still use read tools freely during a turn.
5. The first accepted mutating Pluto tool call consumes the turn.
6. Turn lease enforcement happens in the runtime before the kernel submit.
7. Accepted kernel events remain the only replay truth.
8. On completion, the control server shuts down and the actor session ends.

Tool surface:

- Mutating: `pluto_create_task`, `pluto_change_task_state`, `pluto_append_mailbox_message`, `pluto_publish_artifact`, `pluto_complete_run`
- Read-only: `pluto_read_state`, `pluto_read_artifact`, `pluto_read_transcript`

There is no text parser in the `agentic_tool` control plane. Model text is audit output only; state changes happen through validated tool calls.

## Actor API

T5-S1 introduced the stable actor handoff, T5-S2b added actor wait, and T5-S3a makes `pluto-tool` the canonical test and docs entrypoint for that contract.

For `agentic_tool` runs, the runtime injects these env vars into each actor session:

- `PLUTO_RUN_API_URL`
- `PLUTO_RUN_TOKEN`
- `PLUTO_RUN_ACTOR`

Actors should call Pluto through `pluto-tool`, not by fabricating HTTP headers or bearer auth directly. The current CLI surface is:

- `pluto-tool read-state`
- `pluto-tool create-task --owner=<role|manager> --title=<text>`
- `pluto-tool change-task-state --task-id=<id> --to=<state>`
- `pluto-tool send-mailbox --to=<role|manager> --kind=<kind> --body=<text|@path>`
- `pluto-tool publish-artifact --kind=<final|intermediate> --media-type=<mime> --byte-size=<n> [--body=<text|@path>]`
- `pluto-tool complete-run --status=<succeeded|failed|cancelled> --summary=<text>`
- `pluto-tool wait --timeout-sec=<0-1200>`

`send-mailbox` is the CLI wrapper for the `append-mailbox-message` API tool. The CLI also exposes `read-artifact` and `read-transcript` for targeted evidence lookup.

See `docs/notes/t5-d2b-wait-feasibility.md` and `docs/plans/active/v2-actor-loop-hardening.md` for the wait-path provenance and acceptance context.

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
