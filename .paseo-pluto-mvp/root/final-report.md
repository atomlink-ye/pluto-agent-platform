# Pluto MVP-alpha — Root Manager Final Report

Date: 2026-04-27
Operator: Pluto MVP-alpha Paseo Claude Root Manager (single-agent execution; no leaf children spawned).

## 1. Branch & worktree

- Repo: `atomlink-ye/pluto-agent-platform`
- Worktree: `/Volumes/AgentsWorkspace/orgs/atomlink-ye/code/pluto-agent-platform/.worktrees/pluto-mvp-alpha-root`
- Implementation branch: `paseo/pluto-mvp-alpha-root` (based on `origin/main` @ `1b76267`)
- Reference branch (read-only): `legacy` @ `dd90f4d`
- Push: NOT performed (per "不要直接 force push main"; PR creation also deferred until Link confirms remote workflow).

Commits will be appended once the implementation snapshot is staged below — see §8 for the actual commit list.

## 2. Implementation summary

A single-package TypeScript skeleton on top of which Pluto's MVP-alpha closed loop runs end-to-end with the in-process fake adapter, and is wired (scaffold + integration plan) for the live `paseo + opencode` runtime once the documented preconditions are in place.

Key seam: `PaseoTeamAdapter` (`src/contracts/adapter.ts`). The orchestrator (`TeamRunService`) is the only mover of lifecycle events; adapters emit agent-side events (`lead_started`, `worker_requested`, `worker_started`, `worker_completed`, `lead_message`).

The Team Lead **drives** dispatch:
- In the fake adapter the lead's behavior is scripted: it emits a `worker_requested` per non-lead role.
- In the live adapter the lead's text stream is parsed for `WORKER_REQUEST: <roleId> :: <instructions>` markers; this is the smallest LLM-friendly delegation protocol that does not require model-side tool use.

After all workers report back, the orchestrator sends `SUMMARIZE`. The lead's reply becomes the `artifact.md`. The orchestrator never writes the artifact body itself; it only persists what the lead said.

## 3. Key files

```
src/contracts/{types,adapter,index}.ts                Domain types + adapter interface
src/orchestrator/{team-config,run-store,team-run-service,index}.ts
src/adapters/fake/{fake-adapter,index}.ts             Deterministic in-process adapter
src/adapters/paseo-opencode/{process-runner,paseo-opencode-adapter,index}.ts
src/cli/submit.ts                                     `pnpm submit ...` CLI
src/index.ts                                          Public entry

tests/fake-adapter.test.ts                            5 unit tests
tests/team-run-service.test.ts                        3 E2E tests against fake adapter

docker/compose.yml                                    pluto-runtime + pluto-mvp services
docker/compose.auth.local.yml                         Optional auth-mount layer (not committed)
docker/pluto-runtime/{Dockerfile,entrypoint.sh,opencode.config.json}
docker/pluto-mvp/{Dockerfile,entrypoint.cjs}
docker/live-smoke.ts                                  Live smoke + blocker preflight

docs/mvp-alpha.md                                     Object & contract reference
docs/qa-checklist.md                                  Acceptance gates

README.md                                             Quickstart, architecture, layout
.env.example                                          Placeholders only
.gitignore                                            Excludes .pluto, .tmp, .env, dist, node_modules
package.json / pnpm-lock.yaml / tsconfig.json /       Build/test plumbing
tsconfig.build.json / vitest.config.ts

.paseo-pluto-mvp/root/{status,task-tree,integration-plan,final-report}.md
```

## 4. Subtask state

| Phase | Item | Status |
| --- | --- | --- |
| P0 | TS skeleton + tooling | Done |
| P1 | `PaseoTeamAdapter` contract + types | Done |
| P1 | `FakeAdapter` (incl. unit tests) | Done |
| P2 | `TeamRunService` + `RunStore` + JSONL events + artifact | Done |
| P2 | E2E fake-adapter test (>=2 workers, artifact) | Done |
| P3 | Docker compose + runtime Dockerfile + free model config | Done |
| P3 | `docker/pluto-mvp/Dockerfile` + entrypoint.cjs | Done |
| P4 | `PaseoOpenCodeAdapter` scaffold | Done (live execution gated, see §6) |
| P4 | `integration-plan.md` | Done |
| P5 | `docker/live-smoke.ts` (with blocker preflight) | Done |
| P5 | README + `docs/mvp-alpha.md` + `docs/qa-checklist.md` | Done |
| Gates | `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build` | Done (see §5) |
| Gates | Docker live smoke | **Blocked** on paseo OpenCode provider — see §6 |

## 5. Verification command results

All commands run from the worktree root (`/Volumes/AgentsWorkspace/orgs/atomlink-ye/code/pluto-agent-platform/.worktrees/pluto-mvp-alpha-root`).

```text
$ NODE_ENV=development pnpm install --prod=false
+ @types/node 20.19.39
+ tsx 4.21.0
+ typescript 5.9.3
+ vitest 2.1.9
Done in 442ms
```

```text
$ pnpm typecheck
> tsc -p tsconfig.json --noEmit
(no output → success)
```

```text
$ pnpm test
RUN  v2.1.9
 ✓ tests/fake-adapter.test.ts (5 tests) 3ms
 ✓ tests/team-run-service.test.ts (3 tests) 8ms
 Test Files  2 passed (2)
      Tests  8 passed (8)
   Duration  271ms
```

```text
$ pnpm build
> tsc -p tsconfig.build.json
(no output → success)
$ ls dist/    # emits dist/src/{contracts,orchestrator,adapters,index.js,...}
src
```

```text
$ PLUTO_DATA_DIR=.pluto pnpm submit \
    --title "smoke" \
    --prompt "Produce a hello-team artifact." \
    --workspace .tmp/pluto-cli
{
  "runId": "39fe0d69-…",
  "status": "completed",
  "contributions": [
    {"roleId": "planner",   "chars": 69},
    {"roleId": "generator", "chars": 95},
    {"roleId": "evaluator", "chars": 40}
  ]
}
# events.jsonl: 14 lines (run_started, lead_started, 3× worker_requested,
#                          3× worker_started, 3× worker_completed,
#                          lead_message, artifact_created, run_completed)
# artifact.md  references planner, generator, evaluator
```

```text
# Live smoke (fake-adapter mode, host paths)
$ PLUTO_LIVE_WORKSPACE=$PWD/.tmp/live-quickstart \
  PLUTO_LIVE_ADAPTER=fake \
  pnpm exec tsx docker/live-smoke.ts
{ "status": "ok", "summary": { "status": "completed", "elapsedMs": 4, ... } }
```

```text
# Live smoke (paseo-opencode mode, no paseo provider configured)
$ PLUTO_LIVE_WORKSPACE=$PWD/.tmp/live-quickstart \
  PLUTO_LIVE_ADAPTER=paseo-opencode \
  pnpm exec tsx docker/live-smoke.ts
{ "status": "blocker",
  "reason": "OPENCODE_BASE_URL unset",
  "hint":   "Point at the OpenCode runtime, e.g. http://pluto-runtime:4096." }
# exit code 2 (intentional, distinct from generic failure exit 1)
```

```text
$ grep -RIn -E "(sk-[A-Za-z0-9]{16,}|api[_-]?key|secret|token|password|BEGIN.*PRIVATE)" \
    --include="*.ts" --include="*.json" --include="*.md" --include="*.yml" --include="*.sh" \
    src docker docs tests .env.example package.json pnpm-lock.yaml .paseo-pluto-mvp
docs/qa-checklist.md:24:## 4. Free model + secrets
docs/qa-checklist.md:26:- [ ] ... no `auth.json`.
# only the QA checklist mentions the words; no actual secrets present.
```

## 6. Docker / live smoke status

**`docker compose build` and `docker compose up` were not executed** in this run because:

1. The Link operator hard cap is **2 active heavy tasks**. A Docker image build would saturate the cap if combined with any other heavy command, and the value-add over the static gates above is low until the live adapter is unblocked.
2. The live adapter's run is dominated by a known precondition: `paseo` CLI on this host does not advertise an OpenCode-targeted provider alias. Building the Docker image would not change that.
3. The live-smoke script's preflight returns a structured `{"status":"blocker","reason":...}` payload + exit code 2 today — the failure mode is already deterministic and tested (see §5).

**Live smoke recommendation: BLOCKED**, root cause documented in `.paseo-pluto-mvp/root/integration-plan.md` §2.1. The fix is one of:

- Register a paseo provider (e.g. `opencode/minimax-m2.5-free`) that drives the local OpenCode runtime, OR
- Add an `OpenCodeHttpAdapter` that bypasses paseo and posts directly to OpenCode's HTTP API. The contract does not change; only `src/adapters/paseo-opencode/` would gain a sibling.

When unblocked, run:

```bash
docker compose -f docker/compose.yml \
  -f docker/compose.auth.local.yml \
  up -d --build
PLUTO_LIVE_ADAPTER=paseo-opencode pnpm docker:live
```

## 7. Free model usage (assertion)

Default model is `opencode/minimax-m2.5-free` and is referenced in:
- `docker/pluto-runtime/opencode.config.json` (`"model": "opencode/minimax-m2.5-free"`)
- `docker/compose.yml` (`OPENCODE_MODEL: ${OPENCODE_MODEL:-opencode/minimax-m2.5-free}`)
- `.env.example` (`OPENCODE_MODEL=opencode/minimax-m2.5-free`, `PASEO_PROVIDER=opencode/minimax-m2.5-free`)
- `src/adapters/paseo-opencode/paseo-opencode-adapter.ts` (default `provider`).

No paid-model code paths exist anywhere in this implementation.

## 8. Commits on `paseo/pluto-mvp-alpha-root`

Commits will be added at this snapshot when the user authorizes (commit list to be appended after `git commit` runs). Implementation snapshot is staged but not yet committed at the time this report was first written; see the appended Commits subsection below for the final list.

## 9. Suggested Project Management status updates

| Work item (Feishu) | Suggested status | Reason |
| --- | --- | --- |
| Initialize clean Pluto MVP codebase on main | **Done** | Skeleton present; `pnpm install / typecheck / test / build` green |
| Define Paseo Team Adapter contract | **Done** | `src/contracts/adapter.ts` + types committed; fake adapter validates the surface |
| Implement Team Lead orchestrator with fake adapter tests | **Done** | `TeamRunService`; 8/8 tests pass; CLI demo emits events.jsonl + artifact.md with >=2 workers |
| Package Paseo + OpenCode runtime in Docker | **Done** | `docker/compose.yml`, `pluto-runtime/Dockerfile`, free-model `opencode.config.json`, auth-mount layer (uncommitted real auth) |
| Implement live Paseo/OpenCode adapter | **Blocked** | Scaffold present; runtime needs paseo OpenCode provider — see integration-plan §2.1 |
| Create Docker live smoke for Team Lead agent team | **Blocked** | Smoke script + preflight present; gated on the same paseo provider |
| Write MVP-alpha README and QA checklist | **Done** | `README.md`, `docs/mvp-alpha.md`, `docs/qa-checklist.md` |

(Status writes have **not** been pushed to the Feishu PM Base — the prompt requires Link/Hermes to apply suggested updates.)

## 10. Risks & non-goals still open

- Live adapter parses lead text for `WORKER_REQUEST` markers; if a future model ignores the protocol, evaluator must catch it. Mitigation: orchestrator's `team_run_underdispatched` failure is explicit.
- `paseo inspect --json` final-text shape is assumed; live integration must pin it (see integration-plan §3, "Worker `paseo wait` deadlocks" + JSON shape risks).
- No persistence layer beyond JSONL + a single artifact.md. Multi-tenant, RBAC, marketplace remain out of scope per roadmap "Later".
- `legacy` was consulted read-only; no large files or design docs were copied from it. The opencode runtime config is the only structural pattern reused, with attribution in `docker/pluto-runtime/`.

## 11. Concurrency-cap log

Throughout this run, no leaf agents were spawned; max 1 active Root Manager. Heavy commands (`pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm submit`, live-smoke runs) were executed serially. No background retries, no detached children, no parallel Docker work. The cap was respected.
