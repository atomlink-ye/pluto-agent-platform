# RELIABILITY.md — Pluto MVP-alpha Reliability Policy

## Timeout Policy

| Operation | Default | Max |
|-----------|---------|-----|
| Team run | 8 minutes | 15 minutes |
| Worker session | 5 minutes | 10 minutes |
| Event pump | 250ms interval | - |

Set via `timeoutMs` and `pumpIntervalMs` in TeamRunService.

## Retry Policy (MVP-beta — narrow)

MVP-beta adds per-worker, per-step retry for a narrow set of retryable reasons:

| Retryable reason | Default retries | Configurable | Hard cap |
|---|---|---|---|
| `provider_unavailable` | 1 | `--max-retries N` on `pnpm submit` | 3 |
| `runtime_timeout` | 1 | `--max-retries N` on `pnpm submit` | 3 |

**Non-retryable reasons** (no retry attempted):
- `credential_missing`
- `quota_exceeded`
- `capability_unavailable`
- `runtime_permission_denied`
- `empty_artifact`
- `validation_failed`
- `adapter_protocol_error`
- `runtime_error`
- `unknown`

Legacy persisted aliases are normalized for readers: `worker_timeout` maps to `runtime_timeout`; `quota_or_model_error` maps to `quota_exceeded` for quota/rate-limit/payment cases and `runtime_error` for other model/provider runtime errors.

### Retry observability

- Each retry emits a `kind: 'retry'` event with `{ attempt, reason, originalEventId, delayMs }`.
- `attempt` is 1-indexed; values >1 indicate a retry.
- **No mutation of prior events.** New attempt numbers are append-only in `events.jsonl`.

### Scope limits

- Per-worker, per-step retry only. No run-level rerun.
- No global retry budget, cancel API, scheduler, or queue semantics.
- `--max-retries 0` disables retry entirely.

### Blocker classification

All failures are classified by `src/orchestrator/blocker-classifier.ts` into the canonical 11-value `BlockerReasonV0` taxonomy. The classifier is the single decision point; `team-run-service` calls it at the moment a blocker is recorded.

## Cleanup Policy

Adapters must implement idempotent `endRun`:

- Tear down processes
- Close file handles
- Remove temporary files
- Leave `.pluto/runs/<runId>/` for debugging

## Docker Smoke Recovery

If Docker smoke fails:

```bash
# Full cleanup and retry
docker compose -f docker/compose.yml down -v
pnpm docker:build
pnpm docker:up
pnpm smoke:docker
```

## OPENCODE_BASE_URL Blocker

If `OPENCODE_BASE_URL` is unset with live adapter:

- `docker/live-smoke.ts` prints structured blocker: `{"status":"blocker","reason":"OPENCODE_BASE_URL unset",...}`
- Exits with code 2 (not 1)
- This is intentional: distinguishes configuration missing from runtime failure

## Log Parsing Contamination Guard

- Workers must not emit raw protocol messages (`TEAM LEAD ASSIGNMENT`, `WORKER ASSIGNMENT`, etc.) in artifact.
- `docker/live-smoke.ts` asserts no leaked fragments.
- If detected, exits with code 1 and reports the roles that leaked.

## Concurrency Cap

- **Maximum 2 active tasks** at any time (Paseo + OpenCode sessions).
- MVP scripts serialize runs.
- No background helpers or detached children to bypass cap.

## Error Handling Patterns

1. **Blocker:** Precondition missing → exit 2, structured JSON payload
2. **Transient:** Run continues with partial results
3. **Fatal:** Run records failure, exits 1

## Debugging Failed Runs

Check the run directory:

```bash
ls -la .pluto/runs/<runId>/
cat .pluto/runs/<runId>/events.jsonl
cat .pluto/runs/<runId>/artifact.md
```
