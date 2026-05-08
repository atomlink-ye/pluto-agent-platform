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

## CLI Output

The bridge prints:

- `status`
- `summary`
- `evidencePacketPath`
- `transcriptPaths`
- `exitCode`

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
| Run id | `PLUTO_V2_SMOKE_RUN_ID` | fixed fixture run id for replay |
| Wait timeout | `PLUTO_V2_WAIT_TIMEOUT_SEC` | smoke wait timeout |
| Workspace cwd | `PLUTO_V2_WORKSPACE_CWD` | runtime cwd for spawned actors |

## Evidence Surface

- `evidence-packet.json`
- actor transcript files written under the emitted transcript directory set
- retained live-smoke fixtures under `tests/fixtures/live-smoke/`

## Archive Boundary

v1.6 harness docs, command shapes, and authored-config flows are no longer active control surfaces on `main`.
See `docs/design-docs/v1-archive.md` for recovery details.
