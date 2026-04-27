# RELIABILITY.md — Pluto MVP-alpha Reliability Policy

## Timeout Policy

| Operation | Default | Max |
|-----------|---------|-----|
| Team run | 8 minutes | 15 minutes |
| Worker session | 5 minutes | 10 minutes |
| Event pump | 250ms interval | - |

Set via `timeoutMs` and `pumpIntervalMs` in TeamRunService.

## Retry Policy

**No automatic retry.** The MVP intentionally fails fast:

- If a worker fails, the run continues with partial results.
- The final artifact includes whatever workers completed.
- Failed runs are recorded in events.jsonl with `run_failed`.

Rationale: Faster feedback loop for MVP. Retry logic can be added in later phases.

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