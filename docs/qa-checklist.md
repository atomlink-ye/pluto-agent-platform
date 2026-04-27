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

- [ ] `docker compose -f docker/compose.yml build` succeeds with no auth files baked in.
- [ ] `docker compose -f docker/compose.yml up -d` brings `pluto-runtime` healthy.
- [ ] `docker compose -f docker/compose.yml exec pluto-runtime cat /root/.config/opencode/opencode.json` shows `"model": "opencode/minimax-m2.5-free"`.
- [ ] `docker compose down -v` cleans up.

## 4. Free model + secrets

- [ ] `git diff --stat` shows no `.env`, no `*.token`, no `auth.json`.
- [ ] `grep -R "sk-" -- src docker docs` returns no matches (heuristic, not a security audit).
- [ ] `OPENCODE_MODEL` resolves to `opencode/minimax-m2.5-free` everywhere it appears.

## 5. Live smoke (gated)

Only attempt once the preconditions in `.paseo-pluto-mvp/root/integration-plan.md` are met:

- [ ] `paseo --version` works inside the container or on the host.
- [ ] `pnpm docker:live` returns `{"status":"ok",...}` and writes the artifact.
- [ ] `events.jsonl` shows >=2 `worker_completed` and one `lead_message kind=summary`.
- [ ] If blocked, the script prints a `{"status":"blocker","reason":...}` payload and exits with code 2.

## 6. Concurrency cap (operator)

- [ ] Status doc records the `<= 2 active tasks` cap (`.paseo-pluto-mvp/root/status.md`).
- [ ] No background retry helpers, hidden detached children, or nested OpenCode sessions used to bypass the cap.

## 7. Documentation

- [ ] README quickstart reproducible by a fresh clone.
- [ ] `docs/mvp-alpha.md` contracts match `src/contracts/`.
- [ ] `final-report.md` lists branch, commits, command outputs, blockers, PM status mapping.
