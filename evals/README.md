# evals/ — Agent/Model/Workflow Quality Evaluation

This directory protects model/agent/workflow quality (vs `tests/` which protects correctness).

## Directory Layout

| Directory | Purpose |
|-----------|---------|
| `cases/` | Evaluation cases: inputs and expected outcomes |
| `rubrics/` | Scoring criteria for each case |
| `goldens/` | Reference artifacts (expected outputs) |
| `reports/` | Generated evaluation reports |
| `datasets/` | Test data, fixtures, prompts |

## Principles

- **tests/** = fast, deterministic, CI-safe
- **evals/** = slower, human judgment, evaluation pipelines
- **Never mix them**
- Reports are evidence, not source-of-truth

## Future Eval Runner

A fake evaluator runner may be added here if it becomes genuinely useful for automated scoring. Not added in MVP-alpha.

## Current State

MVP-alpha has a **skeleton only**. The evals infrastructure is stubbed for future phases:

- No cases defined yet
- No rubrics defined yet
- No goldens defined yet
- No automated scoring

## When to Add Evals

Add evals when:
- You want to measure model quality (not correctness)
- You want to measure workflow convergence
- You need human-in-the-loop evaluation

## Reference

- `docs/testing-and-evals.md` — tests vs evals split
- `AGENTS.md` — placement rules
- `QUALITY_SCORE.md` — quality dimensions