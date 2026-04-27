# Integration Plan — Live Paseo + OpenCode Adapter

> Status: scaffold present (`src/adapters/paseo-opencode/`), live execution **gated** on the preconditions below. Fake adapter and Docker harness are independent of these gates.

## 1. The protocol Pluto uses

Pluto does not assume the lead has a "delegate" tool. Instead, it asks the lead to emit a **line-based marker** in its own stdout:

```
WORKER_REQUEST: <roleId> :: <one-line instructions>
```

The orchestrator subscribes to the lead's text stream via `paseo logs <id> --follow --filter text` and translates each marker into an internal `worker_requested` event.

After all workers report back, Pluto sends `paseo send <leadId> "All workers have reported. SUMMARIZE..."`. The lead's next text reply is treated as the final artifact markdown (`lead_message`, `kind="summary"`).

Worker output is captured by reading the worker session's final text after `paseo wait <agentId>` returns.

This protocol is intentionally LLM-friendly so it works whether the model is Claude, Codex, or OpenCode — provided the lead can emit arbitrary text.

## 2. What the live adapter needs to actually run

### 2.1 paseo provider for OpenCode

`paseo run --provider <id>` defaults to `claude`. The live MVP asks paseo to spawn agents that hit the OpenCode runtime configured with `opencode/minimax-m2.5-free`.

- **Required**: a paseo provider alias whose execution path is the local OpenCode runtime (`opencode web` server on `OPENCODE_BASE_URL`).
- **Suggested name**: `opencode/minimax-m2.5-free` (matches `PASEO_PROVIDER` in `.env.example`).
- **Open question**: paseo CLI on this host does not advertise an `opencode` provider out of the box. Either (a) configure paseo to register one, or (b) route around paseo and call the OpenCode HTTP API directly.

Until (a) is in place, `paseo run --provider opencode/minimax-m2.5-free` will fail. This is the dominant blocker for live smoke.

### 2.2 OpenCode auth + free model availability

- The Docker runtime image installs `opencode-ai@1.4.3` (legacy default).
- `opencode/minimax-m2.5-free` requires login to the relevant OpenCode account at runtime. Auth is mounted into the container at `~/.config/opencode/` (see `docker/compose.auth.local.yml` style; not committed, only documented).
- Free model availability is provider-side; if MiniMax 2.5 free is rate-limited or removed, switch to another free profile (do NOT switch to paid) and document the change in `final-report.md`.

### 2.3 paseo daemon

`paseo run` requires the paseo daemon (`paseo daemon status`). The Docker image needs paseo on PATH and either runs `paseo start` in entrypoint OR mounts the host paseo socket. MVP-alpha docs the second option (host paseo, mount socket via `/var/run/paseo.sock` or similar) so we don't ship a paseo build inside the container.

### 2.4 Workspace mount

Lead and worker `--cwd` must point at a path visible inside the container if running in Docker (`/workspace`). The CLI defaults to `.tmp/pluto-cli` for host-mode runs.

## 3. Risk register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| paseo lacks an opencode provider alias | High | Document in this file; either register a provider or replace adapter with direct OpenCode HTTP client |
| Lead model ignores `WORKER_REQUEST` protocol | Medium | Strong system prompt, evaluator role validates; if the model still drops it, fall back to "orchestrator dispatches statically" mode (lead just produces plan) |
| Free model unavailable | Medium | Don't auto-fail — emit blocker in final report and keep fake adapter passing |
| Worker `paseo wait` deadlocks | Low | Per-worker timeout via `--wait-timeout`; orchestrator-level `timeoutMs` catches the whole run |
| stdout JSON shape from `paseo inspect --json` differs from assumed `finalText` field | Medium | Adapter falls back to raw stdout; integration tests must pin the actual shape |

## 4. What to do if live integration is blocked

1. Mark Project Management item "Implement live Paseo/OpenCode adapter" as **Blocked** with reason: "no paseo provider for opencode runtime on this host".
2. Mark "Create Docker live smoke for Team Lead agent team" as **Blocked** with the same root cause.
3. Keep "Initialize / Define adapter / Implement Team Lead orchestrator / Package Paseo + OpenCode runtime in Docker / Write README + QA checklist" as **Done** — they do not depend on live runtime.
4. Final-report must print a single-paragraph "live smoke blocker" section identifying paseo provider config as the gating step.

## 5. Path forward

Smallest unblock: configure paseo with a custom provider that executes `opencode run --model opencode/minimax-m2.5-free` inside the runtime container. Once that exists, Pluto's existing adapter should work end-to-end with no code change beyond the provider name in `.env`.

If paseo doesn't yet support OpenCode providers as a first-class concept, the alternative implementation is to write `OpenCodeHttpAdapter` against the OpenCode HTTP API directly. The contract (`PaseoTeamAdapter`) does not need to change.
