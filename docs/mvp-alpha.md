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
| `EvidencePacketV0` | `.pluto/runs/<runId>/evidence.{md,json}` | redacted persisted evidence packet |

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

Persistence note: adapters may attach in-memory `transient.rawPayload` fields to events so orchestration can read unredacted `instructions`, `output`, or `markdown` during the active run. `RunStore` strips that transient object and redacts payloads before any event is written to `events.jsonl`.

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

---

## → MVP-beta Delta

MVP-beta builds on top of the merged MVP-alpha runtime (PR #60) to add run inspection, error recovery, and evidence generation.

### New objects

| Object | Where it lives | Notes |
| --- | --- | --- |
| `BlockerReasonV0` | `src/contracts/types.ts` | 11-value canonical v0 union for failure classification |
| `EvidencePacketV0` | `src/contracts/types.ts` | Schema for evidence.json produced alongside artifact.md |
| `RunsListOutputV0` / `RunsShowOutputV0` / `RunsEventV0` | `src/contracts/types.ts` | JSON output shapes for CLI |

### New modules

| Module | Purpose |
| --- | --- |
| `src/orchestrator/blocker-classifier.ts` | Maps raw failure signals to `BlockerReasonV0` |
| `src/orchestrator/evidence.ts` | Generator + validator + redactor for evidence packets |
| `src/orchestrator/run-store.ts` | Persists redacted events/artifacts/evidence and powers `pnpm runs` reads |
| `src/cli/runs.ts` | `pnpm runs list/show/events/artifact/evidence` CLI |

### New event types

| Event | Owner | Purpose |
| --- | --- | --- |
| `blocker` | orchestrator | Records classified blocker reason |
| `retry` | orchestrator | Records per-worker retry attempt |

### Additive changes to existing types

- `TeamRunResult.blockerReason?: BlockerReasonV0 | null`

### New run output files

- `.pluto/runs/<runId>/evidence.md` — human-readable evidence packet
- `.pluto/runs/<runId>/evidence.json` — machine-readable evidence packet (`EvidencePacketV0`)

### Retry policy

- Retryable: `provider_unavailable`, `runtime_timeout` only
- Scope: per-worker, per-step (no run-level rerun)
- Default: 1 retry. Configurable via `--max-retries N` (0–3, hard cap 3)
- Retry provenance: each `retry` event stores `originalEventId`, the persisted `blocker` event id that justified the retry

### Evidence write semantics

- Evidence status maps to `done`, `blocked`, or `failed`
- `writeEvidence()` validates the redacted packet before writing
- If evidence validation or file write fails, the orchestrator records blocker reason `runtime_error`, emits `run_failed`, and removes partial evidence files

### Backward compatibility

- `pnpm submit` unchanged in default mode
- Old MVP-alpha runs without evidence files remain listable/showable
- Slice #1 blocker aliases normalize on read/display (`worker_timeout` → `runtime_timeout`; `quota_or_model_error` → `quota_exceeded` for quota/rate-limit/payment cases, otherwise `runtime_error`)
- Existing event shapes and adapter contract remain additive; new transient raw payload fields are in-memory only and never part of persisted v0 JSONL/CLI output

### Slice #3 lifecycle vocabulary lock

Slice #3 documents the compatibility decision only. It does not rename current runtime behavior, persisted files, or API fields.

- v0 implementation emits `status: done` and `kind: run_completed` today.
- v1 target vocabulary is `status: succeeded` and `kind: completion`.
- v0 readers must tolerate both `done` and `succeeded`.
- v0 writers must emit `done`.
- This slice does not migrate on-disk names or API names.
