# Pluto MVP-alpha Root Manager — Status

Last updated: 2026-04-27 (iteration 2 — Docker live closure)

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
- Heavy commands serialized: install / typecheck / test / build / Docker / live smoke runs sequentially.
- No hidden background jobs, delayed retry helpers, or detached children to bypass the cap.

This iteration respected the cap: a single Root Manager, no leaf children, all heavy commands serialized.

## Workstream State (terminal — iteration 2)

| Workstream | Phase Item | Status |
| --- | --- | --- |
| Foundation | P0 TS skeleton | Done |
| Foundation | P1 PaseoTeamAdapter contract + fake adapter | Done |
| Orchestration | P2 TeamRunService + lead orchestration + events + artifact | Done |
| Runtime | P3 Docker compose + OpenCode runtime container | Done (pluto-mvp service removed; rationale below) |
| Runtime | P4 Live PaseoOpenCodeAdapter + integration plan | **Done — live smoke green** |
| Delivery | P5 Live smoke script (`pnpm smoke:fake/live/docker`) | Done |
| Delivery | P5 README + docs + QA checklist | Done |
| Gates | pnpm install / typecheck / test (15/15) / build | Done |
| Gates | `PLUTO_FAKE_LIVE=1 …` fake smoke | Done — `status: ok` |
| Gates | No-endpoint blocker smoke | Done — exit 2, `OPENCODE_BASE_URL unset` |
| Gates | `pnpm smoke:docker` (Docker live mode) | **Done — `status: ok`, 3 real worker contributions, ~43s** |
| Delivery | final-report.md | Done |

See `final-report.md` for full command outputs and PM status mapping.

## Active Now

- (none — Root Manager iteration 2 finished its scope)

## Queued

- (none)

## Blocked

- **None.** The previous "live smoke blocked on paseo provider" item is closed: `paseo provider ls --json` now reports `opencode` as available with default mode `build`, and the live adapter runs end-to-end against `opencode/minimax-m2.5-free`.

## Architectural decision recorded this iteration

- Paseo CLI is a macOS app bundle (`/Applications/Paseo.app`); no Linux distribution exists today.
- Therefore the live PaseoOpenCodeAdapter runs on the **host**, not inside a Linux container.
- The previous `pluto-mvp` Linux service was structurally infeasible and has been removed.
- `pluto-runtime` container remains as an optional OpenCode web UI debug endpoint on `http://localhost:4096`.
- `pnpm smoke:docker` brings the runtime container up, then runs the host-mode live smoke against it.

## Branch / Worktree

- Worktree: `/Volumes/AgentsWorkspace/orgs/atomlink-ye/code/pluto-agent-platform/.worktrees/pluto-mvp-alpha-root`
- Branch: `paseo/pluto-mvp-alpha-root`
- Base: `origin/main` (commit `1b76267`)
- `legacy` (commit `dd90f4d`) consulted read-only.

Implementation commit hashes: see `final-report.md` §8 (appended after `git commit`).
