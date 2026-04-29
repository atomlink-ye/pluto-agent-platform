# Pluto MVP-alpha — Object & Contract Reference

## Goal

Prove the smallest closed loop where Pluto, Paseo, and an OpenCode runtime cooperate to run an agent team led by a Team Lead.

## Objects

| Object | Where it lives | Notes |
| --- | --- | --- |
| `TeamTask` | submitted by user, kept in-memory only | id, title, prompt, workspace path, minWorkers >= 2 |
| `TeamConfig` | `src/orchestrator/team-config.ts` | static `DEFAULT_TEAM` with lead + planner + generator + evaluator |
| `AgentRoleConfig` | `src/contracts/types.ts` | id, kind, system prompt |
| `AgentSession` | adapter-owned | opaque sessionId; adapter-specific `external` payload |
| `AgentEvent` | `.pluto/runs/<runId>/events.jsonl` | append-only JSONL |
| `FinalArtifact` | `.pluto/runs/<runId>/artifact.md` | markdown produced by the lead, contains worker contributions |

## Contract

`PaseoTeamAdapter` (`src/contracts/adapter.ts`):

| Method | Responsibility |
| --- | --- |
| `startRun` | bootstrap per-run state |
| `createLeadSession` | create Team Lead; emit `lead_started` and the lead's `worker_requested` events |
| `createWorkerSession` | create worker; emit `worker_started` then `worker_completed` with the worker's output |
| `sendMessage` | forward operator/orchestrator messages to a session (MVP: lead only) |
| `readEvents` | drain buffered events in arrival order |
| `waitForCompletion` | block until the run is terminal |
| `endRun` | tear down processes, watchers, sessions |

The orchestrator owns lifecycle events: `run_started`, `artifact_created`, `run_completed`, `run_failed`. Adapters never emit those four.

## Event types

```
run_started        orchestrator
lead_started       adapter
worker_requested   adapter (lead's "delegate" signal)
worker_started     adapter
worker_completed   adapter (carries `output` in payload)
lead_message       adapter (`kind: "summary"` carries final markdown)
artifact_created   orchestrator
run_completed      orchestrator
run_failed         orchestrator
```

## Acceptance

A run is acceptable iff:

1. `events.jsonl` contains at least one `run_started`, `lead_started`, two `worker_started`, two `worker_completed`, one `lead_message` of `kind="summary"`, one `artifact_created`, one terminal `run_completed`.
2. `artifact.md` exists and references each contributing worker role by name.
3. The final `TeamRunResult.contributions` length is `>= max(team.workers, task.minWorkers)`.

## Non-goals

- No UI.
- No persistent control-plane DB.
- No multi-tenant or RBAC.
- No marketplace / playbook / harness governance.
- No paid models without explicit authorization.
- No copy of the legacy monorepo into `main`.

## Where each phase lives

| Phase | Files |
| --- | --- |
| P0 skeleton | `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example` |
| P1 contract + fake adapter | `src/contracts/`, `src/adapters/fake/`, `tests/fake-adapter.test.ts` |
| P2 orchestrator | `src/orchestrator/`, `tests/team-run-service.test.ts` |
| P3 docker + opencode runtime | `docker/compose.yml`, `docker/pluto-runtime/*`, `docker/pluto-mvp/*` |
| P4 live adapter | `src/adapters/paseo-opencode/`, `.paseo-pluto-mvp/root/integration-plan.md` |
| P5 docs + smoke | `docker/live-smoke.ts`, `README.md`, `docs/mvp-alpha.md`, `docs/qa-checklist.md` |
