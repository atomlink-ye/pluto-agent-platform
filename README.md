# Pluto Agent Platform — MVP-alpha

Pluto is a **minimal agent team control plane**. MVP-alpha proves a single closed loop:

> Submit a task → Pluto starts a Team Lead via Paseo → the Team Lead orchestrates authored playbook stages via the TeamLead-direct lane (legacy marker fallback still available) → Pluto persists events, transcript evidence, and a final artifact.

For iteration `pluto-regression-fix-20260501`, that default `teamlead_direct` lane is a Pluto-mediated bridge: Pluto enforces the TeamLead-authored playbook deterministically, and adapters can graduate to true host-side teammate spawning through `spawnTeammate()` when the runtime supports it.

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
pnpm runs events <runId> [--follow] [--role ROLE] [--kind KIND] [--since EVENT_ID|TIMESTAMP] [--json]
pnpm runs artifact <runId>
pnpm runs evidence <runId> [--json]
```

All subcommands read from the file-backed `.pluto/runs/` store. `pnpm runs events --follow` tails `events.jsonl` via the run store, prints newline-delimited JSON in `--json` mode, and drains briefly after terminal events so the last persisted records are not missed. Old MVP-alpha runs without evidence files are still listable and showable; `runs evidence <oldRunId>` exits 0 with a graceful message.

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

Legacy persisted values are normalized for readers (`worker_timeout` → `runtime_timeout`; `quota_or_model_error` → `quota_exceeded` or `runtime_error`). Only `provider_unavailable` and `runtime_timeout` trigger per-worker retry (default: 1 retry, configurable via `--max-retries N` on `pnpm submit`, hard cap: 3). Retry provenance is recorded in `retry.payload.originalEventId`, which always points at the persisted `blocker` event that justified the next attempt. See `RELIABILITY.md` for the full policy.

If evidence generation cannot be validated or written, the run is converted to a terminal failure with blocker reason `runtime_error`, a final `blocker` event is appended, and partial evidence files are removed rather than left behind in a half-written state.

## Evidence

Every completed, blocked, or failed run attempts to produce `evidence.md` and `evidence.json` in `.pluto/runs/<runId>/`. The evidence packet (`EvidencePacketV0`) includes: run metadata, per-worker summaries, validation outcome, cited inputs, risks, and open questions. Redaction happens at the write boundary for persisted events and evidence, while adapters may keep raw payload fragments transiently in memory so the live orchestrator can still build the artifact from unredacted worker output. See `SECURITY.md` for the exact redaction policy.

## Live smoke (host Paseo + OpenCode free model)

The live adapter talks to Paseo through the local daemon/socket by default. Set `PASEO_HOST` to make the adapter pass `--host <host>` to `paseo run/wait/logs/send/delete` for a Docker-packaged or remote Paseo daemon. `http://` / `https://` prefixes are normalized away for the Paseo CLI. The OpenCode runtime container in `docker/compose.yml` is optional — it only exposes the OpenCode web UI on `http://localhost:4096` for debugging.

The regression-fix iteration uses an OpenCode remote root manager (`openai/gpt-5.4`, thinking `high`) for remote implementation slices. Host-local live smoke artifacts prefer `/Volumes/AgentsWorkspace/tmp/pluto-regression-fix/live-quickstart/`; when that path is unavailable, `docker/live-smoke.ts` falls back to `<repo>/.tmp/live-quickstart/` and logs the reason.

```bash
cp .env.example .env  # placeholders only — never commit real secrets

# (1) Live smoke directly from host. Requires:
#       - paseo CLI on PATH (the host running the Paseo macOS app)
#       - opencode CLI on PATH, signed in for the free profile
#       - provider/model default to opencode + opencode/minimax-m2.5-free
pnpm smoke:local

# (2) Use an explicit Paseo daemon/API URL for Docker-packaged or remote mode.
#     OPENCODE_BASE_URL is optional and only exposes an OpenCode debug endpoint:
PASEO_HOST=localhost:6767 pnpm smoke:live

# (2b) Force the quarantined legacy marker fallback lane when needed:
PASEO_ORCHESTRATION_MODE=lead_marker pnpm smoke:live

# (3) Or have Pluto build & start the optional pluto-runtime container first.
#     This script auto-sets OPENCODE_BASE_URL as an optional debug endpoint and
#     passes through PASEO_HOST when you provide one:
pnpm smoke:docker
```

Both paths use `opencode/minimax-m2.5-free` by default. Do **not** switch to a paid model without explicit authorization (see `docs/qa-checklist.md`). A live smoke result of `{"status":"partial"}` is acceptable only for evidence packets classified as blocked by `provider_unavailable` or `quota_exceeded`; other blocked/failed evidence outcomes are treated as smoke failures.

Additional live-smoke knobs:
- `PASEO_ORCHESTRATION_MODE=teamlead_direct|lead_marker` — TeamLead-direct is the default; `lead_marker` is the quarantined legacy lane.
- `PASEO_TEAM_PLAYBOOK=teamlead-direct-default-v0|teamlead-direct-research-review-v0` — select the authored TeamLead-direct playbook without code changes.
- `PASEO_REQUIRE_CITATIONS=1` — fail smoke when the final reconciliation omits any required stage citation.

### Verification

Run the full verify command (fast local gates):

```bash
pnpm verify
```

This runs: `pnpm typecheck && pnpm test && pnpm build && pnpm smoke:fake && no-paseo-blocker-check`.

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
- TeamLead-direct default: the selected playbook stages complete in dependency order and `dependencyTrace` records the topological stage sequence.
- Legacy `lead_marker` mode: the lead emits `WORKER_REQUEST: <role> :: <instructions>` markers and Pluto dispatches them as a fallback lane.
- Each requested worker is spawned via Paseo, runs to idle, and reports back.
- The final markdown artifact references all four roles (lead, planner, generator, evaluator).
- The final reconciliation cites every required playbook stage; `PASEO_REQUIRE_CITATIONS=1` makes missing citations a hard smoke failure.
- `events.jsonl` contains the relevant playbook-aware lifecycle: `run_started`, `lead_started`, one `coordination_transcript_created`, one `worker_requested`/`worker_started`/`worker_completed` triplet per selected playbook stage, `lead_message`, `artifact_created`, and terminal `run_completed`. Revision/escalation paths may also emit `revision_started`, `revision_completed`, `escalation`, `final_reconciliation_validated`, and `final_reconciliation_invalid`.
- `evidence.json` validates against `EvidencePacketV0`, and `evidence.md`/`evidence.json` contain no secret-shaped substrings.

### Vocabulary note

Slice #3 documents a compatibility note only: the current v0 runtime still writes `status: done` and event kind `run_completed`. Readers should tolerate the future `succeeded`/`completion` vocabulary, but this branch does not rename stored files, event kinds, or CLI fields.

### Quick-fail (no-paseo blocker)

If `PASEO_BIN` points to an unavailable binary (or `paseo` is not on PATH) and `PLUTO_LIVE_ADAPTER=paseo-opencode`, the smoke script short-circuits with a structured blocker payload and exits with code 2:

```bash
PASEO_BIN=/nonexistent/paseo PLUTO_LIVE_ADAPTER=paseo-opencode pnpm exec tsx docker/live-smoke.ts
# → {"status":"blocker","reason":"paseo CLI unavailable",...}, exit 2
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
