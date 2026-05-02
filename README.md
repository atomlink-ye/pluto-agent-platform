# Pluto Agent Platform — MVP-alpha

Pluto is a **playbook-first agent harness**.

> Select authored `Agent` + `Playbook` + `Scenario` + `RunProfile` → Pluto's
> manager-run harness loads and renders the four layers → Pluto runs the
> Claude-Code-Agent-Teams-aligned mailbox/tasks runtime through a fake or live adapter →
> Pluto persists mailbox/task/evidence artifacts.

The v1.6 mainline is the four-layer manager-run harness with mailbox + shared task list +
active hooks + plan-approval round-trip. Paseo chat is the live mailbox transport.

## Quickstart (offline, no Docker)

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm pluto:run --scenario hello-team --run-profile fake-smoke --workspace .tmp/pluto-cli
```

Outputs:

- `./.pluto/runs/<runId>/mailbox.jsonl`
- `./.pluto/runs/<runId>/tasks.json`
- `./.pluto/runs/<runId>/artifact.md`
- `./.pluto/runs/<runId>/evidence-packet.md`
- `./.pluto/runs/<runId>/evidence-packet.json`

## Run inspection

```bash
pnpm runs list [--limit N] [--status STATUS] [--json]
pnpm runs show <runId> [--json]
pnpm runs events <runId> [--follow] [--role ROLE] [--kind KIND] [--since EVENT_ID|TIMESTAMP] [--json]
pnpm runs artifact <runId>
pnpm runs evidence <runId> [--json]
```

## Live smoke

```bash
pnpm smoke:local
PASEO_HOST=localhost:6767 pnpm smoke:live
pnpm smoke:docker
```

Canonical live-smoke knobs:

- `PASEO_PROVIDER` — provider alias
- `PASEO_MODEL` — model id
- `PASEO_MODE` — adapter launch mode (`orchestrator` by default)
- `PASEO_HOST` — explicit paseo daemon host
- `PLUTO_SCENARIO` — scenario selection
- `PLUTO_RUN_PROFILE` — run-profile selection
- `PLUTO_PLAYBOOK` — playbook override
- `PLUTO_LIVE_WORKSPACE` — workspace override
- `PLUTO_LIVE_ADAPTER` / `PLUTO_FAKE_LIVE` — adapter selection
- `PASEO_BIN` — paseo binary path
- `OPENCODE_BASE_URL` — optional OpenCode debug endpoint

See `docs/harness.md` for the canonical knob table.

## Smoke success criteria

- Run starts and writes `mailbox.jsonl` plus `tasks.json`.
- Planner → generator → evaluator tasks complete in dependency order.
- `mailbox.jsonl` contains team-lead coordination, teammate completion, FINAL summary,
  and plan-approval messages when applicable.
- `evidence-packet.json` records role citations and lineage back to mailbox/task files.
- Final artifact references lead, planner, generator, and evaluator.

## Architecture

```text
ManagerRunHarness
  -> file-backed mailbox mirror + task list
  -> fake adapter (offline) | paseo-opencode adapter (live)
  -> .pluto/runs/<runId>/{mailbox.jsonl,tasks.json,artifact.md,evidence-packet.*}
```

The harness never makes provider/runtime details part of the product schema. The adapter
contract remains the only runtime seam.
