# MVP-alpha QA Checklist

Run after every meaningful change. Mark `[x]` only when the actual command succeeds.

## 1. Static gates

- [ ] `pnpm install` (frozen lockfile preferred once one is generated)
- [ ] `pnpm typecheck`
- [ ] `pnpm test`

## 2. Fake adapter E2E (offline)

- [ ] `pnpm submit --title "smoke" --prompt "produce a hello artifact" --workspace .tmp/pluto-cli`
- [ ] Verify `.pluto/runs/<runId>/events.jsonl` contains `lead_started` and >=2 `worker_completed` events.
- [ ] Verify `.pluto/runs/<runId>/artifact.md` references planner, generator, evaluator.

## 3. Docker stack

> Note: only the OpenCode runtime container is built. The previous `pluto-mvp` Linux service was structurally infeasible (Paseo CLI is a macOS app bundle and cannot be installed in a Linux container) and was removed.

- [ ] `docker compose -f docker/compose.yml build` succeeds with no auth files baked in.
- [ ] `docker compose -f docker/compose.yml up -d` brings `pluto-runtime` healthy.
- [ ] `docker compose -f docker/compose.yml exec pluto-runtime cat /root/.config/opencode/opencode.json` shows `"model": "opencode/minimax-m2.5-free"`.
- [ ] `docker compose down -v` cleans up.

## 4. Free model + secrets

- [ ] `git diff --stat` shows no `.env`, no `*.token`, no `auth.json`.
- [ ] `grep -R "sk-" -- src docker docs` returns no matches (heuristic, not a security audit).
- [ ] `OPENCODE_MODEL` resolves to `opencode/minimax-m2.5-free` everywhere it appears.

## 5. Live smoke (host paseo + opencode free model)

Live runs from the host that owns the Paseo daemon (Paseo is macOS-only). Preconditions in `.paseo-pluto-mvp/root/integration-plan.md` §1.

- [ ] `paseo daemon status` shows the daemon running on host.
- [ ] `paseo provider ls --json` lists `opencode` as `available` with default mode `build`.
- [ ] `OPENCODE_BASE_URL=http://localhost:4096 pnpm smoke:live` returns `{"status":"ok",...}` (allow ~40–80s for the model).
- [ ] `events.jsonl` contains: `run_started`, `lead_started`, ≥3 `worker_requested`, ≥3 `worker_started`, ≥3 `worker_completed`, one `lead_message` (kind=`summary`), one `artifact_created`, one terminal `run_completed`.
- [ ] `artifact.md` contains the strings `lead`, `planner`, `generator`, `evaluator` (assertion the smoke script enforces).
- [ ] If blocked, the script prints a `{"status":"blocker","reason":...}` payload and exits with code 2.

### 5.1 Full Docker live mode (`pnpm smoke:docker`)

- [ ] Builds the `pluto-runtime` image and brings it up healthy on port 4096.
- [ ] Auto-sets `OPENCODE_BASE_URL=http://localhost:4096` and runs the host-mode live smoke.
- [ ] Returns `{"status":"ok",...}` end-to-end with three real worker contributions.

## 6. Concurrency cap (operator)

- [ ] Status doc records the `<= 2 active tasks` cap (`.paseo-pluto-mvp/root/status.md`).
- [ ] No background retry helpers, hidden detached children, or nested OpenCode sessions used to bypass the cap.

## 7. Documentation

- [ ] README quickstart reproducible by a fresh clone.
- [ ] `docs/mvp-alpha.md` contracts match `src/contracts/`.
- [ ] `final-report.md` lists branch, commits, command outputs, blockers, PM status mapping.
