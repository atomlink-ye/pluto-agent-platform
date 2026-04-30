# docs/harness.md — Repo as Control Surface

The repo harness is Pluto MVP-alpha's operating environment. It makes work **observable**, **verifiable**, **repeatable**, and **convergent**.

## What the Harness Provides

| Surface | Purpose |
|---------|---------|
| **AGENTS.md** | Entry point for new agents: where to read, change, validate |
| **ARCHITECTURE.md** | Module responsibilities, dependency direction |
| **DESIGN.md** | Design principles, tradeoffs, constraints |
| **QUALITY_SCORE.md** | Quality dimensions, PR gates |
| **RELIABILITY.md** | Timeout, retry, cleanup, error handling |
| **SECURITY.md** | Secret handling, redaction, forbidden materials |
| **docs/harness.md** | This file — repo as control surface |
| **docs/testing-and-evals.md** | Tests vs evals split, placement rules |
| **scripts/verify.mjs** | Fast local gates (typecheck→test→build→smoke:fake→blocker) |

## Repo Memory (Authoritative Sources)

When in doubt, check source-of-truth order in AGENTS.md:

1. **package.json** — canonical scripts, dependencies
2. **src/contracts/adapter.ts** — adapter interface (only seam)
3. **docs/mvp-alpha.md** — object contracts, acceptance criteria
4. **docker/live-smoke.ts** — live behavior, artifact quality guards
5. **QUALITY_SCORE.md** — quality dimensions and PR gates
6. **RELIABILITY.md** — timeout, retry, cleanup policy

## Map of the Repo

```
src/          # Contracts, orchestrator, adapters
tests/        # Unit + fake adapter E2E (fast, offline; some file-backed checks)
docker/       # compose.yml, runtime, live-smoke.ts
docs/         # mvp-alpha.md, qa-checklist.md, harness docs
scripts/     # verify.mjs
evals/        # cases, rubrics, goldens, reports, datasets
```

## Evidence (Generated)

- **.pluto/runs/<runId>/events.jsonl** — Event log
- **.pluto/runs/<runId>/artifact.md** — Final artifact
- **.pluto/runs/<runId>/evidence.md** — Evidence packet (human-readable, MVP-beta)
- **.pluto/runs/<runId>/evidence.json** — Evidence packet (machine-readable, `EvidencePacketV0`, MVP-beta)
- **evals/reports/** — Evaluation reports

The evidence packet is a new control-surface artifact introduced in MVP-beta. Successful evidence generation writes `evidence.md` and `evidence.json` for completed, blocked, and failed runs and contains: run metadata, canonical `BlockerReasonV0` (when blocked), per-worker contribution summaries, validation outcome, cited inputs (redacted), risks, and open questions. It validates against `EvidencePacketV0` schema and is redacted by `src/orchestrator/evidence.ts` before being written to disk. If evidence generation itself fails, the run is surfaced as `runtime_error` / `run_failed` and partial evidence files are cleaned up instead of being guaranteed to persist.

Persisted events are part of the same control surface. `RunStore.appendEvent()` strips `transient.rawPayload` and rewrites payloads through the same redactor, while live adapters may still keep raw payload fragments in memory long enough for orchestration and artifact synthesis.

## Control Knobs

| Knob | Env Var | Purpose |
|------|--------|---------|
| Adapter | `PLUTO_LIVE_ADAPTER` | fake or paseo-opencode |
| Endpoint | `OPENCODE_BASE_URL` | Live smoke guard |
| Workspace | `PLUTO_LIVE_WORKSPACE` | Run directory |
| Free model | `opencode/minimax-m2.5-free` | Default (do not change) |

## CLI Surfaces

- `pnpm runs list/show/events/artifact/evidence` all read from `.pluto/runs/`.
- `pnpm runs events --follow` is a real file-backed follow mode over `events.jsonl`, with role/kind/since filters applied to each poll.
- `pnpm runs evidence` degrades gracefully for pre-evidence runs instead of failing.

## For New Agents

1. Read **AGENTS.md** for repo map and workflow.
2. Read **ARCHITECTURE.md** for module responsibilities.
3. Make minimal changes, add regression test in `tests/`.
4. Run `pnpm verify` before stopping.
5. Update docs only if behavior changed.
