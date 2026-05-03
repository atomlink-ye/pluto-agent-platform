# Plan: Agent Teams v1.6

## Status

Status: Active

## Goal

Replace Pluto's v1.5 team-lead-direct plus fallback runtime with a single Claude Code Agent Teams aligned runtime built on mailbox, shared task list, active hooks, and plan-approval round-trips, targeting paseo chat as the mailbox transport and deleting the v1 bridge and v1.5 fallback paths entirely.

Forward pointer: v1.6 commit `72e063d` did not actually wire paseo chat into the live
path. Stage B of `agent-teams-chat-mailbox-runtime` is the planned wiring step.

## Scope

- Add new four-layer primitives for mailbox, task list, hooks, and plan approval.
- Rewrite the manager harness, live adapter, fake adapter, prompt render path, audit path, evidence path, CLI wiring, and authored run profiles around those primitives.
- Delete legacy bridge vocabulary and code paths, including `TeamRunService`, `lead_marker`, underdispatch fallback logic, `worker_requested` / `worker_completed` event usage, and `RunProfile.coordination`.
- Rewrite canonical design docs and aligned repo docs to describe v1.6 as the default and only runtime.
- Replace bridge-oriented tests with mailbox/task-list/hook/plan-approval coverage and updated orchestration coverage.

## Constraints

- Root manager and any sub-managers stay on `openai/gpt-5.4` FULL.
- OpenCode Companion leaves must use `--agent orchestrator` with the default model only.
- Live smoke runs use `PASEO_MODEL=openai/gpt-5.4-mini`.
- No push, PR, sandbox teardown, or compatibility cohabitation.

## Workstreams

1. Primitives: `src/four-layer/{mailbox,task-list,hooks,plan-approval}.ts` plus schema support.
2. Runtime rewrite: `src/orchestrator/manager-run-harness.ts`, adapters, render, audit, evidence, CLI, and deletion cleanup.
3. Fixtures and tests: authored YAML updates, fake/live run-profile updates, orchestration and primitive coverage.
4. Documentation and completion record: canonical design-doc rewrite, repo-doc sync, final completed plan.

## Baseline

- Baseline commit verified: `33ab2b8`.
- `bash tasks/remote/agent-teams-v1_6/commands.sh preflight` is not fully green before changes because `tests/cli/extensions.test.ts` times out at the existing 15s limit on this host. This must be rechecked and, if still present after v1.6 integration, stabilized or documented as a pre-existing gate issue in the final report.

## Verification Plan

1. Green fast gates in the integration worktree: `pnpm typecheck`, `pnpm test --reporter dot`, `pnpm build`, `pnpm smoke:fake`, `pnpm verify`.
2. Green live acceptance with `hello-team` and `add-greeting-fn` using `run-profile live-agent-teams` and `adapter paseo-opencode`.
3. Zero delete-list matches in `src/` and `tests/` for the forbidden bridge vocabulary.
4. Independent OpenCode review session over the integrated diff, gate logs, live logs, and delete-list result.

## Risks

- Target transport note: paseo chat reliability may require Pluto-owned mailbox export to remain the authoritative store, with paseo chat acting as transport or notification only.
- The existing baseline timeout may be unrelated to v1.6 and could still affect final gate runs.
