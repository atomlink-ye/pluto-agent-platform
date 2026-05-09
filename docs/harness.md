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
pnpm pluto:runs replay <runId> [--run-dir=<path>]
pnpm pluto:runs explain <runId> [--run-dir=<path>] [--format=json]
pnpm pluto:runs audit <runId> [--run-dir=<path>] [--format=json]
```

`pluto:run` remains the execution entrypoint. `pluto:runs` is the retained post-run inspection surface; `audit` exits 0 on `pass`, 1 on `failed_audit`, 2 when the final-reconciliation evidence is absent.

## Runtime Modes

| Mode | Purpose | Active Path |
| --- | --- | --- |
| `deterministic` | byte-stable regression lane | fenced JSON prompts in the deterministic Paseo adapter |
| `agentic_tool` | live agentic lane | `runPaseo()` + in-process Pluto MCP server |

## `agentic_tool` Flow

`agentic_tool` runs keep the kernel in-process and hand each actor the stable Pluto actor API via a run-level CLI binary.

1. `runPaseo()` loads the authored spec and starts one Pluto control server for the lifetime of the run.
2. The runtime materializes a single run-level binary at `<runDir>/bin/pluto-tool` and one per-actor wrapper that forwards to it; the wrapper's directory is on the actor's `PATH`.
3. The runtime issues a per-actor bearer token; the wrapper carries it via stored handoff metadata. Server-side validation requires every mutating call to present `Pluto-Run-Actor: <actor>` AND a bearer whose bound actor matches; cross-actor reuse fails closed with `403 actor_mismatch`.
4. The control server exposes the fixed 8-tool primitive surface plus runtime-side composite verbs (see below).
5. Actors call `pluto-tool --actor <key> <command>`. The first accepted mutating call consumes the turn; mutating commands then auto-wait for the next relevant event unless `--no-wait` is passed.
6. Turn lease enforcement happens in the runtime before the kernel submit.
7. Accepted kernel events remain the only replay truth.
8. On completion, the control server shuts down and the actor session ends.

Primitive tool surface:

- Mutating: `pluto_create_task`, `pluto_change_task_state`, `pluto_append_mailbox_message`, `pluto_publish_artifact`, `pluto_complete_run`
- Read-only: `pluto_read_state`, `pluto_read_artifact`, `pluto_read_transcript`

Composite verbs (runtime-side translation to primitives; no kernel changes):

- `pluto_worker_complete` — change-task-state(completed) + completion mailbox to lead.
- `pluto_evaluator_verdict` — optional close + final/task mailbox to lead, keyed by `verdict`.
- `pluto_final_reconciliation` — `complete_run` with structured citations (completed tasks, cited messages, optional cited artifacts and unresolved issues).

There is no text parser in the `agentic_tool` control plane. Model text is audit output only; state changes happen through validated tool calls.

## Actor API

For `agentic_tool` runs, the runtime materializes a self-contained run-level binary and hands each actor a forwarding wrapper. The wrapper is on the actor's `PATH`, and stored handoff metadata supplies the API URL, the actor's bound bearer token, and the actor key. Actors should never fabricate HTTP headers or bearer auth.

CLI surface (every mutating command requires `--actor <key>`):

- `pluto-tool --actor <key> read-state [--format=text]`
- `pluto-tool --actor <key> create-task --owner=<role|manager> --title=<text>`
- `pluto-tool --actor <key> change-task-state --task-id=<id> --to=<state>`
- `pluto-tool --actor <key> send-mailbox --to=<role|manager> --kind=<kind> --body=<text|@path>`
- `pluto-tool --actor <key> publish-artifact --kind=<final|intermediate> --media-type=<mime> --byte-size=<n> [--body=<text|@path>]`
- `pluto-tool --actor <key> complete-run --status=<succeeded|failed|cancelled> --summary=<text>`
- `pluto-tool --actor <key> wait --timeout-sec=<0-1200>` *(rarely needed; mutations auto-wait)*
- `pluto-tool --actor <key> worker-complete --task-id=<id> --summary=<text> [--artifacts=<ref>...]`
- `pluto-tool --actor <key> evaluator-verdict --task-id=<id> --verdict=<pass|needs-revision|fail> --summary=<text>`
- `pluto-tool --actor <key> final-reconciliation --completed-tasks=<id>... --cited-messages=<id>... --summary=<text> [--cited-artifacts=<ref>...] [--unresolved-issues=<text>...]`

Wait lifecycle: mutating commands return a `turnDisposition` and auto-wait by default when the disposition is `waiting`. Pass `--no-wait` to opt out, or `--wait-timeout-ms=<ms>` (or env `PLUTO_WAIT_TIMEOUT_MS`) to override. Do not poll with `read-state` between same-actor mutations — the runtime tracks `ActorTurnState` and surfaces driver traces (`turn_state_transition`, `wait_silent_rearm`).

`send-mailbox` is the CLI wrapper for the `append-mailbox-message` API tool. The CLI also exposes `read-artifact` and `read-transcript` for targeted evidence lookup.

See `docs/notes/t5-d2b-wait-feasibility.md` for wait-path provenance, and `docs/plans/completed/v2-harness-workflow-hardening.md` and `docs/plans/completed/v2-wait-disconnect-resilience.md` for the T9–T10 hardening that landed `--actor`, per-actor token binding, auto-wait, and silent re-arm.

## Live Smoke Knobs

CLI-launched Paseo actors now default to `orchestrator` mode. Set `PASEO_MODE=build` to force the older mode, and the CLI will log a warning and retry with `build` if a sandbox rejects `orchestrator` at spawn time.

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
- `projections/tasks.json`
- `projections/mailbox.jsonl`
- `projections/artifacts.json`
- `evidence-packet.json`
- `usage-summary.json`
- `final-report.md`
- `artifacts/*.txt`
- `evidence/final-reconciliation.json` *(optional; populated by the final-reconciliation audit lane)*
- `paseo-transcripts/*.txt`
- `authored-spec.yaml`, `playbook.md`, `playbook.sha256` for `agentic_tool` smoke captures
- retained live-smoke fixtures under `tests/fixtures/live-smoke/`

## Archive Boundary

v1.6 harness docs, command shapes, and authored-config flows are no longer active control surfaces on `main`.
See `docs/design-docs/v1-archive.md` for recovery details.
