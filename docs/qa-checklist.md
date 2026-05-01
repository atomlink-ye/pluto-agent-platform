# MVP-alpha QA Checklist

Run after every meaningful change. Mark `[x]` only when the actual command succeeds. Default orchestration mode is `teamlead_direct`; `lead_marker` remains a legacy/fallback lane that should still be spot-checked when its tests or docs move.

## 1. Static gates

- [ ] `pnpm install` (frozen lockfile preferred once one is generated)
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm verify` runs `pnpm spec:hygiene` in the default non-required mirror mode, so verify still passes when the production mirror is absent.
- [ ] Local authors can point the hygiene check at a mirror with `pnpm spec:hygiene --input <path-to-mirror>`.
- [ ] Example production-mirror check: `pnpm spec:hygiene --input .local/manager/spec-prd-trd-qa-rewrite/hierarchy/`

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

Live uses the local Paseo daemon/socket by default. Set `PASEO_HOST` to run against an explicit Docker-packaged or remote Paseo daemon/API URL via `paseo --host`. Preconditions in `.paseo-pluto-mvp/root/integration-plan.md` §1.

- [ ] `paseo daemon status` shows the daemon running on host.
- [ ] `paseo provider ls --json` lists `opencode` as `available` with default mode `build`.
- [ ] `pnpm smoke:local` returns `{"status":"ok",...}` or `{"status":"partial","reason":"provider_unavailable"|"quota_exceeded",...}` (allow ~40–80s for the model).
- [ ] For Docker/remote Paseo daemon mode, `PASEO_HOST=<host> pnpm smoke:live` uses the same provider/model and returns the same acceptable status shape.
- [ ] `PASEO_ORCHESTRATION_MODE=lead_marker pnpm smoke:live` still passes for the quarantined legacy fallback lane.
- [ ] `PASEO_TEAM_PLAYBOOK=teamlead-direct-research-review-v0 pnpm smoke:live` passes or returns an allowed provider/quota partial, proving the non-default playbook path.
- [ ] `events.jsonl` is playbook-aware: it contains `run_started`, `lead_started`, one `coordination_transcript_created`, one `worker_requested` / `worker_started` / `worker_completed` triplet per selected playbook stage, one `lead_message` (kind=`summary`), one `artifact_created`, and one terminal `run_completed`; revision/escalation cases may also include `revision_started`, `revision_completed`, `escalation`, `final_reconciliation_validated`, and `final_reconciliation_invalid`.
- [ ] `artifact.md` contains the strings `lead`, `planner`, `generator`, `evaluator` (assertion the smoke script enforces).
- [ ] `summary.orchestrationMode === "teamlead_direct"` by default and `summary.finalReconciliation.valid === true` when `PASEO_REQUIRE_CITATIONS=1`.
- [ ] Only preflight blockers print `{"status":"blocker","reason":...}` and exit with code 2.
- [ ] If the run starts and evidence ends `blocked` for any reason other than `provider_unavailable` or `quota_exceeded`, the script prints `{"status":"failed",...}` and exits with code 1.

### 5.1 Full Docker live mode (`pnpm smoke:docker`)

- [ ] Builds the `pluto-runtime` image and brings it up healthy on port 4096.
- [ ] Auto-sets `OPENCODE_BASE_URL=http://localhost:4096` (optional debug endpoint) and passes through `PASEO_HOST` when provided.
- [ ] Returns `{"status":"ok",...}` end-to-end with three real worker contributions.

## 6. Evidence packet (MVP-beta)

- [ ] `pnpm submit --title "evidence test" --prompt "produce a test artifact" --workspace .tmp/pluto-cli` produces `evidence.md` and `evidence.json` in `.pluto/runs/<runId>/`.
- [ ] `pnpm runs evidence <runId> --json` validates against `EvidencePacketV0` schema.
- [ ] Evidence files contain no token-shaped substrings, no env KEY=VALUE secrets, no raw provider stderr.
- [ ] `pnpm smoke:fake` asserts evidence files present, schema valid, no redacted-secret patterns.
- [ ] `evidence.orchestration.transcript` is the only transcript reference shape; no tests or readers depend on removed flat transcript fields.

## 7. BlockerReason taxonomy (MVP-beta)

- [ ] All 11 canonical values exercised in `tests/blocker-classifier.test.ts`: `provider_unavailable`, `credential_missing`, `quota_exceeded`, `capability_unavailable`, `runtime_permission_denied`, `runtime_timeout`, `empty_artifact`, `validation_failed`, `adapter_protocol_error`, `runtime_error`, `unknown`.
- [ ] Legacy aliases normalize on read/display: `worker_timeout` → `runtime_timeout`; `quota_or_model_error` → `quota_exceeded` for quota/rate-limit/payment cases, otherwise `runtime_error`.
- [ ] Only `provider_unavailable` and `runtime_timeout` are retryable; all others are not.
- [ ] `--max-retries 0` disables retry; hard cap 3 enforced.

## 8. CLI subcommand smoke (MVP-beta)

- [ ] `pnpm runs list` returns runs; `--json` matches `RunsListOutputV0`.
- [ ] `pnpm runs show <runId>` prints metadata; `--json` matches `RunsShowOutputV0`.
- [ ] `pnpm runs events <runId>` prints filtered persisted events; `--role` and `--kind` reject unknown values with non-zero exit.
- [ ] `pnpm runs events <runId> --follow --json` emits newline-delimited JSON objects and drains through the terminal event (`tests/cli/runs-follow.test.ts`).
- [ ] `pnpm runs events <runId> --since <eventId|timestamp>` returns only events strictly after the matched point.
- [ ] `pnpm runs artifact <runId>` prints artifact markdown.
- [ ] `pnpm runs evidence <runId>` prints evidence markdown; `--json` prints validated `EvidencePacketV0`.
- [ ] Old MVP-alpha runs show `evidencePresent=false`; `runs evidence <oldRunId>` exits 0 with graceful message.

## 9. Redaction (MVP-beta)

- [ ] `tests/evidence-redaction.test.ts` covers: token shapes, env-name patterns, raw provider stderr, `.env`-style key=value.
- [ ] `tests/run-store-redaction.test.ts` proves `RunStore` persists redacted payloads and re-redacts legacy unredacted event logs on read.
- [ ] `tests/team-run-service-redaction.test.ts` proves persisted `events.jsonl` is redacted while live orchestration can still use transient raw payloads.
- [ ] `tests/paseo-opencode-adapter.test.ts` proves adapter events redact persisted payloads while keeping raw `output` / `markdown` transient only.
- [ ] `pnpm smoke:fake` asserts no token-shaped substrings in evidence files.
- [ ] Evidence generation redacts known secret env names, JWT-like tokens, GitHub tokens, sk-* API keys, and absolute workspace paths.

## 10. Concurrency cap (operator)

- [ ] Status doc records the `<= 2 active tasks` cap (`.paseo-pluto-mvp/root/status.md`).
- [ ] No background retry helpers, hidden detached children, or nested OpenCode sessions used to bypass the cap.

## 11. Retry provenance and evidence-failure handling

- [ ] Retry events record `originalEventId` pointing to a real persisted `blocker` event.
- [ ] `tests/team-run-service-recovery.test.ts` covers persisted-id provenance, retry hard cap, and non-retryable reasons.
- [ ] `tests/evidence-failure.test.ts` proves evidence write/validation failures surface as blocker reason `runtime_error`, emit `run_failed`, and do not leave partial evidence files behind.

## 12. Documentation

- [ ] README quickstart reproducible by a fresh clone.
- [ ] `docs/mvp-alpha.md` contracts match `src/contracts/`.
- [ ] Lifecycle vocabulary note stays explicit: v0 still writes `done` / `run_completed`; readers tolerate future `succeeded` / `completion`.
- [ ] `final-report.md` lists branch, commits, command outputs, blockers, PM status mapping.
- [ ] Repository-documentation consistency check passes: code, contracts, CLI behavior, docs/plans, design docs, and reference docs do not contradict each other.
- [ ] Non-trivial completed work has a completed plan record with verification evidence and remaining follow-up; no stale active plan remains for completed work.
