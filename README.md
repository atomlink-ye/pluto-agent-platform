# Pluto Agent Platform — MVP-alpha

> **Status (2026-05-07):** the v1.6 manager-run harness on `main` is now treated as a
> **legacy reference prototype**. New development happens against the v2 rewrite plan at
> [`docs/plans/active/v2-rewrite.md`](docs/plans/active/v2-rewrite.md). The v1.6 snapshot
> at the time of freeze is preserved on the `legacy-v1.6-harness-prototype` branch on
> `origin`. v2 is the default runtime as of S6; pass `--runtime=v1` for the legacy v1.6
> path during the transition window. See `docs/design-docs/v2-cli-default-switch.md`
> for the transition guide.

Pluto is a **playbook-first agent harness**.

> Select authored `Agent` + `Playbook` + `Scenario` + `RunProfile` → Pluto's
> manager-run harness loads and renders the four layers → Pluto runs the
> Claude-Code-Agent-Teams-aligned mailbox/tasks runtime through a fake or live adapter →
> Pluto persists mailbox/task/evidence artifacts.

The v1.6 mainline is the four-layer manager-run harness with mailbox + shared task list +
active hooks + plan-approval round-trip. Paseo chat is the target live mailbox transport
after `agent-teams-chat-mailbox-runtime` Stage B.

## Quickstart (offline, no Docker)

```bash
pnpm install
pnpm typecheck
pnpm test
# Inspect the compiled run package before execution:
pnpm pluto:package -- --scenario hello-team --run-profile fake-smoke
# Execute the legacy v1.6 harness offline during the transition window:
pnpm pluto:run --runtime=v1 --scenario hello-team --run-profile fake-smoke --workspace .tmp/pluto-cli
```

Short deprecation note: `--runtime=v1` remains available for the legacy v1.6 manager-run harness, but it now prints a deprecation warning and will be archived in S7. See `docs/design-docs/v2-cli-default-switch.md` for the transition guide.

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
- `PLUTO_DISPATCH_MODE` — dispatch mode (`teamlead_chat` by default, `static_loop` fallback)
- `PLUTO_RUNTIME_HELPER_MVP` — opt-in unified Pluto mailbox helper MVP
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
- `events.jsonl` records `spawn_request_received`, `spawn_request_executed`, `worker_complete_received`, and `final_reconciliation_received` with `orchestrationSource: "teamlead_chat"` in the chat-driven path.
- When `PLUTO_RUNTIME_HELPER_MVP=1`, the canonical helper lives at `.pluto-runtime/pluto-mailbox` (the only materialized executable; role is a parameter, not a path), runtime-injected env (`PLUTO_RUNTIME_HELPER_CONTEXT` / `_ROLE` / `_RUN_ID`) is authoritative over CLI flags, and `.pluto/runs/<runId>/runtime-helper-usage.jsonl` shows helper-authored mailbox activity.
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
