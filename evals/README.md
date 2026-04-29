# evals/ — Agent/Model/Workflow Quality Evaluation

This directory protects model/agent/workflow quality (vs `tests/` which protects correctness).

## Directory Layout

| Directory | Purpose |
|-----------|---------|
| `cases/` | Evaluation cases: inputs and expected outcomes |
| `rubrics/` | Scoring criteria for each case |
| `goldens/` | Reference artifacts (expected outputs) |
| `reports/` | Generated evaluation reports (JSON reports are transient and gitignored) |
| `datasets/` | Test data, fixtures, prompts |

## Principles

- **tests/** = fast, deterministic, CI-safe
- **evals/** = workflow/model quality evaluation pipelines
- **Never mix them**
- Reports are evidence, not source-of-truth

## Workflow Quality Eval

MVP-alpha now includes one deterministic automated eval lane:

```bash
pnpm eval:workflow
```

This command runs `evals/runner.ts` with the in-process `FakeAdapter` only (no Docker, no live model calls), scores the run against `rubrics/workflow-quality-v1.json`, writes `evals/reports/workflow-quality-latest.json`, and prints a markdown summary.

## Current State

MVP-alpha has one real workflow-quality eval plus room for future lanes:

- `cases/workflow-quality-v1.json` — deterministic fake-adapter case
- `rubrics/workflow-quality-v1.json` — weighted scoring dimensions
- `goldens/workflow-quality-v1.md` — reference passing artifact
- `datasets/fake-run-fixture.json` — expected fake run event shapes
- `runner.ts` — automated offline scorer

## When to Add Evals

Add evals when:
- You want to measure model quality (not correctness)
- You want to measure workflow convergence
- You need human-in-the-loop evaluation

## Reference

- `docs/testing-and-evals.md` — tests vs evals split
- `AGENTS.md` — placement rules
- `QUALITY_SCORE.md` — quality dimensions
