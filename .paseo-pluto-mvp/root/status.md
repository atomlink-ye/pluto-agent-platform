# Pluto MVP-alpha Root Manager — Status

Last updated: 2026-04-27 (terminal)

## Mission

From clean `main`, build the minimal closed loop where:

1. Pluto receives a team task.
2. Pluto talks to Paseo via a `PaseoTeamAdapter` to start a Team Lead session.
3. The Team Lead dispatches >= 2 workers and produces a final artifact.
4. The whole loop is reproducible via fake adapter (unit tests) and Docker + OpenCode free model (live smoke).

## Resource & Concurrency Constraints (Link, hard cap)

- Machine has **limited memory**. At most **2 active tasks** may run in parallel at any time.
- Cap covers: child agents, worker tasks, OpenCode sessions, heavy build/test/install jobs, Docker build/up jobs, background retries.
- Default formation: 1 Root Manager + at most 2 active child/worker tasks. Extras queued.
- Heavy commands serialized.
- No hidden background jobs, delayed retry helpers, or detached children to bypass the cap.

This run respected the cap: a single Root Manager, no leaf children, all heavy commands serialized.

## Workstream State (terminal)

| Workstream | Phase Item | Status |
| --- | --- | --- |
| Foundation | P0 TS skeleton | Done |
| Foundation | P1 PaseoTeamAdapter contract + fake adapter | Done |
| Orchestration | P2 TeamRunService + lead orchestration + events + artifact | Done |
| Runtime | P3 Docker + OpenCode runtime config | Done |
| Runtime | P4 Live PaseoOpenCodeAdapter + integration plan | Done (live exec gated) |
| Delivery | P5 Live smoke script | Done |
| Delivery | P5 README + docs + QA checklist | Done |
| Gates | pnpm install / typecheck / test / build | Done — 8/8 vitest, typecheck + build clean |
| Gates | Docker live smoke | Blocked — paseo OpenCode provider missing |
| Delivery | final-report.md | Done |

See `final-report.md` for full command outputs and PM status mapping.

## Active Now

- (none — Root Manager finished its scope)

## Queued

- (none)

## Blocked

- Live Paseo/OpenCode adapter execution → `integration-plan.md` §2.1 (no paseo provider alias for OpenCode on this host).
- Docker live smoke → same root cause.

## Branch / Worktree

- Worktree: `/Volumes/AgentsWorkspace/orgs/atomlink-ye/code/pluto-agent-platform/.worktrees/pluto-mvp-alpha-root`
- Branch: `paseo/pluto-mvp-alpha-root`
- Base: `origin/main` (commit `1b76267`)
- `legacy` (commit `dd90f4d`) consulted read-only.

Implementation commit hash: see `final-report.md` §8 (appended after `git commit`).
