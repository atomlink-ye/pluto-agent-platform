# RELIABILITY.md — Pluto MVP-alpha Reliability Policy

## Timeout Policy

| Operation | Default | Max |
|-----------|---------|-----|
| Team run | 10 minutes | 15 minutes |
| Adapter wait window | 5 minutes | 10 minutes |
| Poll / read loop | implementation-defined | - |

## Runtime policy (v1.6)

- The default and only runtime is the mailbox + shared task list path.
- Target after `agent-teams-chat-mailbox-runtime` Stage B: mailbox transport uses paseo
  chat in live mode. Until then, Pluto mirrors authoritative runtime evidence into
  `mailbox.jsonl` and `tasks.json`.
- Active hooks (`TaskCreated`, `TaskCompleted`, `TeammateIdle`) are part of the runtime
  control path and may block continuation.
- Plan approval is a typed mailbox round-trip, not an out-of-band operator action.

## Cleanup Policy

Adapters must implement idempotent `endRun` and leave `.pluto/runs/<runId>/` intact for
debugging and evidence inspection.

## Paseo CLI Blocker

If `PASEO_BIN` points to an unavailable binary or `paseo` is not on PATH with the live
adapter:

- `docker/live-smoke.ts` prints a structured blocker
- exits with code 2
- this is intentional and distinct from runtime failure

## Error Handling Patterns

1. **Blocker:** missing live prerequisite → exit 2, structured JSON payload
2. **Fail-closed audit:** missing mailbox/task/file/citation evidence → failed or failed_audit
3. **Fatal:** run records failure and exits non-zero
