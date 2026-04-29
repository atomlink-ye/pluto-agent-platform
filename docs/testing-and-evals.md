# docs/testing-and-evals.md — Tests vs Evals Split

## Tests vs Evals

| Category | Location | Purpose | Characteristics |
|----------|----------|---------|-----------------|
| **tests/** | `tests/*.test.ts` | Protect correctness | Fast, deterministic, no I/O |
| **evals/** | `evals/cases/`, `evals/rubrics/`, `evals/runner.ts` | Protect model/workflow quality | Deterministic lanes plus future human judgment |

**Never mix them.** tests/ runs in CI. evals/ is for evaluation pipelines.

## Placement Rules

### Unit Tests (`tests/*.test.ts`)

- No I/O, no network, no Docker
- Fast (<15s each, see vitest.config.ts)
- Deterministic with fake adapter
- Example: `tests/team-run-service.test.ts`

### Integration/Smoke Tests

- Can use fake adapter: `pnpm smoke:fake`
- Runs in CI with Docker when needed: `pnpm smoke:docker`
- Example: `docker/live-smoke.ts`

### Live E2E

- Requires `OPENCODE_BASE_URL` set
- Runs outside CI (human in loop)
- Example: `pnpm smoke:live`

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

# No-endpoint blocker (asserts exit 2)
PLUTO_LIVE_ADAPTER=paseo-opencode pnpm exec tsx docker/live-smoke.ts

# Full verify (includes all fast gates)
pnpm verify

# Docker smoke (broader, requires Docker)
pnpm smoke:docker

# Live smoke (requires OPENCODE_BASE_URL, host Paseo)
OPENCODE_BASE_URL=http://localhost:4096 pnpm smoke:live
```

## Future DB Testing Lane

When a database is introduced:

- **Unit tests:** No DB connection (tests stay offline)
- **Integration:** Disposable Docker DB + migrations + minimal fixtures
- **E2E smoke:** Uses compose for full stack

MVP-alpha has no DB yet. This lane is documented for future phases.
