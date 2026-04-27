# Pluto Agent Platform — MVP-alpha

Pluto is a **minimal agent team control plane**. MVP-alpha proves a single closed loop:

> Submit a task → Pluto starts a Team Lead via Paseo → the Team Lead dispatches at least two workers via OpenCode → Pluto persists events and a final artifact.

Everything else (UI, multi-tenant control plane, governance, marketplace) is intentionally out of scope. See `docs/mvp-alpha.md`.

The previous implementation is frozen on the `legacy` branch and is referenced read-only.

## Quickstart (offline, no Docker)

```bash
pnpm install
pnpm typecheck
pnpm test
```

Run the orchestrator end-to-end against the in-process fake adapter:

```bash
pnpm submit \
  --title "Hello team" \
  --prompt "Produce a hello-team markdown artifact." \
  --workspace .tmp/pluto-cli
```

Outputs:
- `./.pluto/runs/<runId>/events.jsonl` — append-only event log
- `./.pluto/runs/<runId>/artifact.md` — Team Lead's final markdown

## Live smoke (Docker + OpenCode free model)

```bash
cp .env.example .env  # placeholders only — never commit real secrets
docker compose -f docker/compose.yml up -d --build
pnpm docker:live      # equivalent to: tsx docker/live-smoke.ts
```

Default model: `opencode/minimax-m2.5-free`. Do **not** switch to a paid model without explicit authorization (see `docs/qa-checklist.md`).

If your OpenCode account requires login, layer the auth-only compose file:

```bash
docker compose \
  -f docker/compose.yml \
  -f docker/compose.auth.local.yml \
  up -d --build
```

`docker/compose.auth.local.yml` mounts your local `~/.config/opencode/` read-only into the runtime. The contents are never committed.

## Architecture

```
+--------------+        PaseoTeamAdapter         +----------------------+
|  TeamRun     | -----------------------------> | FakeAdapter          |
|  Service     |                                | (tests / offline CLI)|
|              |                                +----------------------+
|              |
|              | -----------------------------> +----------------------+
|              |                                | PaseoOpenCodeAdapter |
|              |        Paseo CLI (run/         | (live smoke)         |
|              |        send/logs/wait/inspect) |   uses paseo + the   |
|              |                                |   OpenCode runtime   |
+--------------+                                +----------------------+
       |
       v
.pluto/runs/<runId>/{events.jsonl, artifact.md}
```

The orchestrator never imports OpenCode. The contract (`src/contracts/adapter.ts`) is the only seam between business logic and runtime concerns.

## Project layout

```
src/
  contracts/      types + PaseoTeamAdapter interface
  orchestrator/   TeamRunService, RunStore, static team config
  adapters/
    fake/                  in-process deterministic adapter
    paseo-opencode/        live adapter scaffold (paseo CLI)
  cli/submit.ts   `pnpm submit ...` CLI

tests/            vitest specs (unit + fake-adapter E2E)
docker/           compose.yml, runtime + mvp Dockerfiles, live-smoke.ts
docs/             mvp-alpha.md, qa-checklist.md
.pluto/           runtime state — gitignored
```

## Status & limits

- Concurrency cap inherited from operator: at most **2 active heavy tasks** at any time (children, OpenCode sessions, Docker build/up). MVP scripts serialize.
- Live adapter is a scaffold. Run preconditions are documented in `.paseo-pluto-mvp/root/integration-plan.md`.
- Final readiness report: `.paseo-pluto-mvp/root/final-report.md`.

## Reference branches

- `main` — clean MVP-alpha base.
- `legacy` — frozen prior implementation. Read-only reference for Docker / OpenCode patterns.
