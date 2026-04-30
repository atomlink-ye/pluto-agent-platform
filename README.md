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
- `./.pluto/runs/<runId>/evidence.md` — Evidence packet (human-readable)
- `./.pluto/runs/<runId>/evidence.json` — Evidence packet (machine-readable, `EvidencePacketV0`)

## Run inspection

Inspect runs after submission:

```bash
pnpm runs list [--limit N] [--status STATUS] [--json]
pnpm runs show <runId> [--json]
pnpm runs events <runId> [--role ROLE] [--kind KIND] [--since EVENT_ID] [--json]
pnpm runs artifact <runId>
pnpm runs evidence <runId> [--json]
```

All subcommands read from the file-backed `.pluto/runs/` store. Old MVP-alpha runs without evidence files are listable and showable; `runs evidence <oldRunId>` exits 0 with a graceful message.

## Error recovery

Failures are classified into the canonical 11-value `BlockerReasonV0` taxonomy:
- `provider_unavailable` — host/daemon/provider not reachable, 5xx, network errors
- `credential_missing` — required credential or secret ref is absent
- `quota_exceeded` — quota, rate limit, payment, or budget cap blocks execution
- `capability_unavailable` — requested runtime/tool/model capability is unavailable
- `runtime_permission_denied` — runtime or tool authorization is denied
- `runtime_timeout` — worker or runtime exceeded its wait window
- `empty_artifact` — run completed but artifact is empty/whitespace-only
- `validation_failed` — evaluator found the artifact unacceptable
- `adapter_protocol_error` — adapter callback/event contract is malformed
- `runtime_error` — non-quota runtime/model/provider error
- `unknown` — catch-all

Legacy persisted values are normalized for readers (`worker_timeout` → `runtime_timeout`; `quota_or_model_error` → `quota_exceeded` or `runtime_error`). Only `provider_unavailable` and `runtime_timeout` trigger per-worker retry (default: 1 attempt, configurable via `--max-retries N` on `pnpm submit`, hard cap: 3). See `RELIABILITY.md` for the full policy.

## Evidence

Every completed or blocked run produces `evidence.md` and `evidence.json` in `.pluto/runs/<runId>/`. The evidence packet (`EvidencePacketV0`) includes: run metadata, per-worker summaries, validation outcome, cited inputs, risks, and open questions. All content is redacted before writing — see `SECURITY.md` for the redaction policy.

## Live smoke (host Paseo + OpenCode free model)

The Paseo CLI is a macOS app bundle and is not installable inside a Linux Docker container, so the live adapter runs on the **host** that owns the Paseo daemon. The OpenCode runtime container in `docker/compose.yml` is optional — it only exposes the OpenCode web UI on `http://localhost:4096` for debugging.

```bash
cp .env.example .env  # placeholders only — never commit real secrets

# (1) Live smoke directly from host. Requires:
#       - paseo CLI on PATH (the host running the Paseo macOS app)
#       - opencode CLI on PATH, signed in for the free profile
#       - OPENCODE_BASE_URL set (kept as a deterministic safety gate)
OPENCODE_BASE_URL=http://localhost:4096 pnpm smoke:live

# (2) Or have Pluto build & start the optional pluto-runtime container first,
#     and then run the same host-mode smoke against it (this script auto-sets
#     OPENCODE_BASE_URL):
pnpm smoke:docker
```

Both paths use `opencode/minimax-m2.5-free` by default. Do **not** switch to a paid model without explicit authorization (see `docs/qa-checklist.md`).

### Verification

Run the full verify command (fast local gates):

```bash
pnpm verify
```

This runs: `pnpm typecheck && pnpm test && pnpm build && pnpm smoke:fake && no-endpoint-blocker-check`.

See `scripts/verify.mjs` for details.

If your OpenCode account requires login, layer the auth-only compose file:

```bash
docker compose \
  -f docker/compose.yml \
  -f docker/compose.auth.local.yml \
  up -d --build
```

`docker/compose.auth.local.yml` mounts your local `~/.config/opencode/` read-only into the runtime. The contents are never committed.

### Smoke success criteria (asserted by `docker/live-smoke.ts`)

- Pluto creates a Team Lead session via Paseo and records `lead_started`.
- The lead emits ≥ 2 `WORKER_REQUEST: <role> :: <instructions>` markers.
- Each requested worker is spawned via Paseo, runs to idle, and reports back.
- The final markdown artifact references all four roles (lead, planner, generator, evaluator).
- `events.jsonl` contains the canonical lifecycle: `run_started → lead_started → 3× worker_requested/started/completed → lead_message → artifact_created → run_completed`.

### Quick-fail (no-endpoint blocker)

If `OPENCODE_BASE_URL` is unset and `PLUTO_LIVE_ADAPTER=paseo-opencode`, the smoke script short-circuits with a structured blocker payload and exits with code 2 BEFORE probing Paseo:

```bash
PLUTO_LIVE_ADAPTER=paseo-opencode pnpm exec tsx docker/live-smoke.ts
# → {"status":"blocker","reason":"OPENCODE_BASE_URL unset",...}, exit 2
```

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
.pluto/runs/<runId>/{events.jsonl, artifact.md, evidence.md, evidence.json}
```

The orchestrator never imports OpenCode. The contract (`src/contracts/adapter.ts`) is the only seam between business logic and runtime concerns.

## Project layout

```
src/
  contracts/      types + PaseoTeamAdapter interface
  orchestrator/   TeamRunService, RunStore, team-config, blocker-classifier, evidence
  adapters/
    fake/                  in-process deterministic adapter
    paseo-opencode/        live adapter scaffold (paseo CLI)
  cli/
    submit.ts     `pnpm submit ...` CLI
    runs.ts       `pnpm runs ...` CLI (list/show/events/artifact/evidence)

tests/            vitest specs (unit + fake-adapter E2E + recovery + evidence + CLI)
docker/           compose.yml, runtime + mvp Dockerfiles, live-smoke.ts
docs/             mvp-alpha.md, qa-checklist.md, harness.md, testing-and-evals.md
evals/            cases, rubrics, goldens, datasets, reports, runner.ts
.pluto/           runtime state — gitignored
```

## Status & limits

- Concurrency cap inherited from operator: at most **2 active heavy tasks** at any time (children, OpenCode sessions, Docker build/up). MVP scripts serialize.
- Live adapter is a scaffold. Run preconditions are documented in `.paseo-pluto-mvp/root/integration-plan.md`.
- Final readiness report: `.paseo-pluto-mvp/root/final-report.md`.

## Reference branches

- `main` — clean MVP-alpha base.
- `legacy` — frozen prior implementation. Read-only reference for Docker / OpenCode patterns.
