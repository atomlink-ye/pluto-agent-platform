# docs/testing-and-evals.md — Tests vs Evals Split

## Tests vs Evals

| Category | Location | Purpose | Characteristics |
|----------|----------|---------|-----------------|
| **tests/** | `tests/*.test.ts` | Protect correctness | Fast, deterministic, offline; small local file I/O is allowed when the behavior under test is file-backed |
| **evals/** | `evals/cases/`, `evals/rubrics/`, `evals/runner.ts` | Protect model/workflow quality | Deterministic lanes plus future human judgment |

**Never mix them.** tests/ runs in CI. evals/ is for evaluation pipelines.

## Evaluation Acceptance Gate

Every evaluation, checklist, review, or acceptance pass must include a
repository-documentation consistency check. Code, contracts, CLI behavior,
generated evidence expectations, docs/plans, design docs, and reference docs must
not contradict each other.

If implementation changed behavior, contracts, workflows, or product shape and
affected docs were not updated, the evaluation must fail or mark the work
blocked. If non-trivial planned work is completed, the related active plan must
be moved to `docs/plans/completed/` with verification evidence and remaining
follow-up recorded.

## Placement Rules

### Unit Tests (`tests/*.test.ts`)

- No network, no Docker; keep file I/O limited to local deterministic coverage where the runtime behavior is file-backed
- Fast (<15s each, see vitest.config.ts)
- Deterministic with fake adapter
- Example: `tests/team-run-service.test.ts`

MVP-beta test lanes:
- `tests/blocker-classifier.test.ts` — all 11 canonical `BlockerReasonV0` values plus legacy aliases exercised
- `tests/team-run-service-recovery.test.ts` — retry semantics, hard cap, no-mutation
- `tests/evidence.test.ts` — done/blocked/failed packets, schema validation, file writing
- `tests/evidence-failure.test.ts` — partial-file cleanup on write failure and runtime_error escalation when evidence generation fails
- `tests/evidence-redaction.test.ts` — token shapes, env patterns, JWT, GitHub tokens
- `tests/run-store-redaction.test.ts` — redacted persistence plus safe reads of legacy unredacted event logs
- `tests/team-run-service-redaction.test.ts` — persisted-event redaction with transient raw payload retained only in memory
- `tests/paseo-opencode-adapter.test.ts` — adapter-boundary redaction and transient raw `output` / `markdown`
- `tests/cli/runs.test.ts` — JSON output shapes for all `pnpm runs` subcommands, old-run degradation
- `tests/cli/runs-follow.test.ts` — real `pnpm runs events --follow` streaming, filters, and terminal drain behavior

### Integration/Smoke Tests

- Can use fake adapter: `pnpm smoke:fake`
- Runs in CI with Docker when needed: `pnpm smoke:docker`
- Example: `docker/live-smoke.ts`
- Live smoke classifies evidence outcomes as:
  - `ok` when evidence status is `done`
  - `partial` only when evidence status is `blocked` for `provider_unavailable` or `quota_exceeded`
  - failure for every other blocked/failed evidence outcome
  - default mode `teamlead_direct`; use `PASEO_ORCHESTRATION_MODE=lead_marker` only for the quarantined legacy fallback lane

### Live E2E

- Runs outside CI (human in loop)
- Requires `paseo` CLI on PATH (or `PASEO_BIN` env var)
- Uses local Paseo daemon/socket by default; set `PASEO_HOST` for Docker-packaged or remote daemon/API mode (`paseo --host`)
- Optional: `OPENCODE_BASE_URL` for OpenCode HTTP debug endpoint (Docker only)
- Example: `pnpm smoke:local` (local daemon/socket) or `PASEO_HOST=localhost:6767 pnpm smoke:live` (explicit daemon host)

### Eval Cases (`evals/cases/`)

- Model/workflow quality evaluation
- Free-form or automated workflow-quality scenarios
- Not automated in CI

### Rubrics (`evals/rubrics/`)

- Scoring criteria for eval cases
- Human-interpretable metrics

### Golden Outputs (`evals/goldens/`)

- Reference artifacts for comparison
- Not automatically verified

### Datasets (`evals/datasets/`)

- Test data for evals
- Fixtures, prompts, expected outputs

### Workflow Eval Runner (`evals/runner.ts`)

- Offline deterministic scoring with `FakeAdapter`
- Writes transient machine-readable reports under `evals/reports/`
- Runs with `pnpm eval:workflow`
- MVP-beta: added `evidence_quality` dimension (0.15 weight) — checks evidence.md + evidence.json presence, schema validity, and absence of secret-shaped content on persisted outputs

## Canonical Commands

```bash
# Fast local gates (no Docker, no live)
pnpm typecheck
pnpm test
pnpm build

# Fake adapter E2E
pnpm smoke:fake

# Deterministic workflow-quality eval (fake adapter, no live calls)
pnpm eval:workflow

# No-paseo blocker (asserts exit 2 when PASEO_BIN unavailable)
PASEO_BIN=/nonexistent/paseo PLUTO_LIVE_ADAPTER=paseo-opencode pnpm exec tsx docker/live-smoke.ts

# Full verify (includes all fast gates)
pnpm verify

# Docker smoke (broader, requires Docker; pass PASEO_HOST when using an explicit daemon/API URL)
pnpm smoke:docker

# Local live smoke (no Docker, uses host paseo + opencode CLI)
pnpm smoke:local

# Explicit Paseo daemon/API host; optional OpenCode HTTP debug endpoint
PASEO_HOST=localhost:6767 pnpm smoke:live
OPENCODE_BASE_URL=http://localhost:4096 pnpm smoke:live

# Legacy marker fallback lane, playbook selection, and citation enforcement knobs
PASEO_ORCHESTRATION_MODE=lead_marker pnpm smoke:live
PASEO_TEAM_PLAYBOOK=teamlead-direct-research-review-v0 pnpm smoke:live
PASEO_REQUIRE_CITATIONS=1 pnpm exec tsx docker/live-smoke.ts
```

## Future DB Testing Lane

When a database is introduced:

- **Unit tests:** No DB connection (tests stay offline)
- **Integration:** Disposable Docker DB + migrations + minimal fixtures
- **E2E smoke:** Uses compose for full stack

MVP-alpha has no DB yet. This lane is documented for future phases.
