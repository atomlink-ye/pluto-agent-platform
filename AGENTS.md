# AGENTS.md — Pluto MVP-alpha Agent Guidance

Quick reference for agents joining this repo. Keep changes focused and observable.

v1.6 runtime note: the default and only runtime path is the four-layer manager-run
harness (`src/orchestrator/manager-run-harness.ts`) with Claude-Code-Agent-Teams-aligned
coordination: mailbox + shared task list + active hooks + plan-approval round-trip.
Paseo chat is the mailbox transport; Pluto mirrors mailbox/task-list state into the run
directory for evidence.

## Repo Map

```text
src/
  contracts/      # types + PaseoTeamAdapter interface
  orchestrator/   # manager-run harness, RunStore, static team config
  adapters/
    fake/         # deterministic in-memory mailbox/task runtime
    paseo-opencode/ # live adapter (Paseo CLI + OpenCode)
  cli/run.ts      # pnpm pluto:run CLI
  cli/submit.ts   # legacy compatibility CLI

tests/            # vitest specs (unit + E2E)
docker/           # compose.yml, runtime, live-smoke.ts
docs/             # harness.md, testing-and-evals.md, mvp-alpha.md, qa-checklist.md
scripts/          # verify.mjs
evals/            # cases, rubrics, goldens, reports, datasets
```

## Source-of-Truth Order

1. **package.json** — canonical scripts, dependencies
2. **src/contracts/adapter.ts** — adapter interface (only seam to runtime)
3. **docs/mvp-alpha.md** — object contracts, acceptance criteria
4. **docker/live-smoke.ts** — live behavior, artifact quality guards
5. **QUALITY_SCORE.md** — quality dimensions and PR gates
6. **RELIABILITY.md** — timeout, retry, cleanup policy

## Task Workflow

1. Understand the change and identify affected files.
2. For non-trivial planned work, create or update a plan under `docs/plans/active/` before implementation.
3. Run fast gates: `pnpm typecheck && pnpm test`.
4. Implement changes. Keep changes minimal and focused.
5. Add regression test in `tests/` (not `evals/`) when behavior changes.
6. Keep the active plan current as scope, blockers, verification, or follow-up changes.
7. Run full verify: `pnpm verify`.
8. Update user-facing docs, design docs, and reference docs whenever behavior, contracts, workflows, or product shape change.
9. When completed and verified, move the plan from `docs/plans/active/` to `docs/plans/completed/` with evidence, verification summary, and remaining follow-up.

Trivial/local edits do not need a plan record. Do not leave stale active plans for completed work.

## Evaluation and Acceptance Gate

Every evaluation, checklist, review, or acceptance pass must include a repository-documentation consistency check:

- Code, contracts, CLI behavior, generated evidence expectations, docs/plans, design docs, and reference docs must not contradict each other.
- If implementation changed behavior, contracts, workflows, or product shape and affected docs were not updated, the evaluation must fail or mark the work blocked.
- If docs changed without matching source-of-truth updates where required, the evaluation must flag the mismatch before acceptance.
- Completed plan records must cite the verification evidence and any remaining follow-up.

## Canonical Commands

```bash
# Fast local gates (no Docker, no live runtime)
pnpm typecheck
pnpm test
pnpm build
pnpm pluto:run --scenario hello-team --run-profile fake-smoke --workspace .tmp/pluto-cli
pnpm smoke:fake

# Full verify
pnpm verify

# Live smoke
pnpm smoke:local
pnpm smoke:live
pnpm smoke:docker
```

See `docs/harness.md` for the canonical live-smoke knob table (`PASEO_PROVIDER`,
`PASEO_MODEL`, `PASEO_MODE`, `PASEO_HOST`, `PLUTO_SCENARIO`, `PLUTO_RUN_PROFILE`,
`PLUTO_PLAYBOOK`, `PLUTO_LIVE_WORKSPACE`, `PLUTO_LIVE_ADAPTER`, `PLUTO_FAKE_LIVE`,
`PASEO_BIN`, `OPENCODE_BASE_URL`).

## Placement Rules

| What | Where | Notes |
|------|-------|-------|
| Unit tests | `tests/*.test.ts` | Fast, no I/O, deterministic |
| Integration/smoke | `tests/*.test.ts` or `docker/live-smoke.ts` | Use fake adapter |
| Live E2E | `docker/live-smoke.ts` | Requires paseo CLI |
| Eval cases | `evals/cases/` | Model/workflow quality |
| Rubrics | `evals/rubrics/` | Scoring criteria |
| Golden outputs | `evals/goldens/` | Reference artifacts |
| Eval reports | `evals/reports/` | Generated evidence |
| Datasets | `evals/datasets/` | Test data |

> **Never mix tests/ and evals/.** `tests/` protects correctness; `evals/` protects model/agent/workflow quality.

## Documentation Sync Rules

- Behavior change → update `docs/harness.md`
- Contract change → update `docs/mvp-alpha.md` and `src/contracts/`
- Quality criteria change → update `QUALITY_SCORE.md`
- Reliability policy change → update `RELIABILITY.md`
- Workflow/product-shape change → update relevant `docs/design-docs/` and plan records
- Live smoke knob/path change → update `README.md`, `docs/harness.md`, `docs/qa-checklist.md`, and `docs/testing-and-evals.md`
- Never duplicate docs. Point to canonical sources.

## Forbidden Actions

- **Do not** commit secrets, tokens, .env files, Feishu/Lark IDs, or connection strings.
- **Do not** use paid models without explicit authorization.
- **Do not** add DB/Redis dependencies (unit tests must stay offline).
- **Do not** remove artifact quality guards in live-smoke.ts.
- **Do not** modify legacy branch.
- **Do not** merge PR #60 (leave as draft).
- **Do not** force-push.
