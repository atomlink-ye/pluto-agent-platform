# Integration Plan — Live Paseo + OpenCode Adapter

> Status as of iteration 2 (2026-04-27): live smoke is **working end-to-end** on host with the Paseo daemon and `opencode/minimax-m2.5-free`. The adapter and Docker stack reflect the architectural reality below.

## 1. Architectural reality (verified)

- **Paseo CLI is a macOS app bundle.** `/Users/<user>/.local/bin/paseo` is a thin shell wrapper that invokes `/Applications/Paseo.app/Contents/MacOS/Paseo`. There is no Linux binary distribution today, so Paseo cannot be installed inside a Linux Docker container.
- **The Paseo daemon runs on the host** (default `127.0.0.1:6767`). Provider CLIs (`claude`, `codex`, `opencode`) are spawned by the daemon as host processes.
- **`paseo provider ls --json`** reports `opencode` as `available` with default mode `build` and modes `Build, Plan, Orchestrator`.
- **`opencode/minimax-m2.5-free`** returns deterministic responses end-to-end via `paseo run --provider opencode/minimax-m2.5-free --mode build`. This is the model used by every live agent.
- **`paseo logs <id> --filter text`** emits plain text in the form
  ```
  [User] <prompt>
  <assistant text>
  [Thought] <reasoning>
  ```
  Assistant turns are NOT tagged. There is no `--json` mode for `logs`.
- **`paseo inspect <id> --json`** returns metadata only (no conversation text).
- **`paseo wait`** uses `--timeout <seconds>` (NOT `--wait-timeout`).

Implications:

1. The live PaseoOpenCodeAdapter must **run on the host** that owns the Paseo daemon.
2. The OpenCode runtime container in `docker/compose.yml` is **optional** — it serves the OpenCode web UI on port 4096 for debugging, but the live adapter does not need it because `paseo run --provider opencode/...` invokes the host `opencode` CLI directly.
3. The previous `pluto-mvp` Linux container was structurally infeasible and has been removed from compose.

## 2. The protocol Pluto uses with the lead

Pluto does not assume the lead has a "delegate" tool. The lead emits **one line per worker** in plain text:

```
WORKER_REQUEST: <roleId> :: <one-line instructions>
```

The orchestrator subscribes to the lead's text stream via `paseo logs <id> --follow --filter text` and translates each marker into an internal `worker_requested` event.

After all workers report back, Pluto sends `paseo send <leadId> "<single-line summary request>"`. The lead's reply is the final artifact markdown. The adapter:

- Collapses multi-line summary requests into a single line (`/\r?\n+/g → " | "`) so `paseo logs` renders the operator turn as a single `[User] …` line. Without that, the assistant-text extractor cannot disambiguate user-message body from assistant text (paseo only tags `[User]` / `[Thought]`).
- Reads the lead's final text via `paseo logs <id> --filter text --tail N` after `paseo send` (and a defensive `paseo wait`) returns. The extractor slices from the last `[User]` line and drops `[Tag]` lines.

## 3. CLI surface used by the adapter

| Adapter call | Paseo CLI |
| --- | --- |
| spawn lead/worker | `paseo run --detach --json --provider opencode/minimax-m2.5-free --mode build --cwd <abs> --title <t> "<prompt>"` |
| stream lead text | `paseo logs <id> --follow --filter text` |
| wait for idle | `paseo wait <id> --timeout <s> --json` |
| send follow-up | `paseo send <id> "<single-line msg>"` (default blocks until idle) |
| read final text | `paseo logs <id> --filter text --tail <N>` |
| teardown | `paseo delete <id>` (no `--force` flag) |

Defaults set in the adapter:

- `provider = opencode/minimax-m2.5-free` (env `PASEO_PROVIDER`).
- `mode = build` (the OpenCode-provider default; do NOT use `bypassPermissions`, which is a Claude-provider mode).
- `waitTimeoutSec = 180`, `logsTail = 200`.

## 4. Live smoke entry points

```
pnpm smoke:fake     → in-process FakeAdapter, offline, instant
pnpm smoke:live     → host paseo + opencode (requires OPENCODE_BASE_URL set)
pnpm smoke:docker   → bring up pluto-runtime container, then run smoke:live
                      (the container is optional — it just exposes the OpenCode
                      web UI on http://localhost:4096 for debugging)
```

`docker/live-smoke.ts` keeps a deterministic preflight: when `OPENCODE_BASE_URL` is unset, it short-circuits with `{"status":"blocker","reason":"OPENCODE_BASE_URL unset",…}` and exits with code 2 BEFORE probing the Paseo CLI (commit `f6163f7`). `pnpm smoke:docker` injects `OPENCODE_BASE_URL=http://localhost:4096` automatically. `PLUTO_FAKE_LIVE=1` is honored as a synonym for `PLUTO_LIVE_ADAPTER=fake`.

## 5. What changed in iteration 2 (Docker live closure)

- `pluto-mvp` Linux service removed from `docker/compose.yml` (paseo not installable in Linux). `docker/pluto-mvp/` deleted.
- `pluto-runtime` container kept as the optional OpenCode debug endpoint.
- `PaseoOpenCodeAdapter`:
  - default `mode` flipped from `bypassPermissions` to `build`.
  - text extraction switched from `paseo inspect --json` to `paseo logs --filter text`.
  - `paseo wait` now passes `--timeout <s>`.
  - SUMMARIZE message is normalized to a single line.
  - Static `extractAssistantTextFromLogs` exposed for unit testing.
  - Idempotent `paseo delete` cleanup in `endRun`.
- `live-smoke.ts` defaults `WORKSPACE` to `${cwd}/.tmp/live-quickstart` (host-friendly) and accepts `PLUTO_FAKE_LIVE=1`.
- New unit suite `tests/paseo-opencode-adapter.test.ts` covers log parsing + adapter protocol against a mocked process runner.
- README, qa-checklist, and this plan updated.

## 6. Risks still tracked

| Risk | Severity | Notes |
| --- | --- | --- |
| Lead model ignores `WORKER_REQUEST` markers | Medium | Strong system prompt + the orchestrator emits `team_run_underdispatched` if fewer workers reported than required |
| Free model rate limit / removal | Medium | Default is `opencode/minimax-m2.5-free`; if it disappears, do NOT switch to paid — declare blocker |
| Paseo CLI surface drift | Low | Empirical CLI usage is documented in adapter's top-of-file comment; one place to refresh |
| Multi-line user message bleeding into assistant text | Closed | Adapter normalizes `paseo send` payload to one line |
| paseo OS distribution change (e.g. linux build appears) | Low | Compose is structured so a future linux paseo binary could re-introduce the `pluto-mvp` service without breaking host-mode |

## 7. Path to richer live tests

- Today the smoke validates: lead session, ≥2 worker contributions, artifact references each role. That matches the MVP-alpha contract.
- Next steps when warranted: add a second smoke that exercises iterative lead/worker conversation (multiple SUMMARIZE → revision rounds), stricter artifact JSON-schema validation, and parallel worker dispatch.
