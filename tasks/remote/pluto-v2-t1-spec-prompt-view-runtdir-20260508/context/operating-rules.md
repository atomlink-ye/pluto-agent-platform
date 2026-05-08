# Local-root operating rules

> Cross-iteration operating rules for the local Claude root in this repo. Read at the start of every session before launching long-running work.

## R1 — Background-wait fallback wakeup (BINDING)

Whenever the local root is about to enter a sleep / wait / Monitor state — i.e. waiting on a background `paseo wait`, a long shell command, a remote agent, or any external event whose completion arrives via a notification rather than an inline tool result — there MUST be exactly one active fallback wakeup set.

**Critical correction (2026-05-04, refined after empirical verification):** Neither `ScheduleWakeup` nor `CronCreate` provides truly-independent timer-driven wake-ups in a paseo-managed root that is continuously running a background `paseo wait`. Per the CronCreate tool description, "**Jobs only fire while the REPL is idle (not mid-query).**" A bg `paseo wait` counts as in-flight; queued crons sit until the next idle window, then arrive batched as a multi-prompt user message. Verified empirically by setting one-shot crons at 12:42 / 13:14 / 13:46 and seeing all three arrive together at ~13:46.

The most reliable wake source in this session is the **background `paseo wait` task-completion notification** — the runtime delivers task notifications even mid-query, so they actually wake the REPL on time.

**Tool to use:**

| Need | Tool |
|------|------|
| Primary wake source (most reliable) | `paseo wait --host <host> --timeout 1800 <agent-id>` launched as a background bash task; its `[Task Notification] completed` reliably wakes the REPL |
| Fallback in case the bg wait dies silently | `CronCreate` (one-shot, `recurring: false`) — may arrive late/batched but at least guaranteed eventual delivery; visible in `CronList` |
| Inside `/loop` dynamic mode | `ScheduleWakeup` |
| Anywhere else | `ScheduleWakeup` is harmless extra but does NOT count as the fallback |

Hard rules:

1. **Always set one** before entering the wait. Even when a background notification is expected, set the wakeup as belt-and-suspenders. Notifications can be dropped, delayed, or arrive in states that don't actually mean "done" (e.g. `paseo wait` returns 0 on permission requests, not just on idle).
2. **Default delay: 30 minutes**. Use shorter when there's a defensible reason to expect the underlying signal sooner (e.g. 5–15 min for a small remote slice, 20 min for a typical implementation slice). Cache windows: prefer 60–270 s (cache warm) for active polling, 1200–1800 s (5–30 min) for idle waits.
3. **Maximum delay: 30 minutes.** Never schedule beyond 30 min. (`ScheduleWakeup` runtime caps at 3600 s but this rule binds tighter; `CronCreate` has no cap so the rule is the only guard.)
4. **Singleton.** There must be exactly one fallback wakeup at a time.
   - `ScheduleWakeup` replaces on re-call automatically.
   - `CronCreate` does NOT — call `CronDelete` on the previous job ID before creating a new one (or let one-shots auto-delete after firing). Track the most recent job ID across the session.
5. **Always verify after scheduling.** Immediately after creating the wakeup, confirm it is actually queued — for `CronCreate` this means the returned job ID is non-empty (and `CronList` should show it). If the schedule call returns nothing actionable, the fallback is broken and you must fix it before re-entering wait.
6. **Always have one.** The system must always have a valid pending wakeup whenever the root is in a non-blocking-on-the-user state. If the root finishes a wait and immediately enters another, refresh; never let the wakeup lapse.

Picking the delay:

- Background-task notifications expected within minutes → wakeup slightly longer than expected wait (e.g. expected ~15 min → wakeup at 20 min as fallback).
- Long remote slice (~30+ min) → wakeup at 30 min (the cap), planning to refresh on first arrival.
- Idle-waiting on something that takes hours → keep refreshing at 30 min on each tick. Never go beyond 30 min.

`CronCreate` cron-expression form for one-shot wakeups: `"<min> <hour> <dom> <month> *"` in the user's local timezone. Example: now is 11:35 local on May 4, want to wake at 11:53 → `cron: "53 11 4 5 *"`, `recurring: false`. Avoid `:00` and `:30` minute marks (per CronCreate convention).

What the wakeup `prompt` field should be (both tools):

- For autonomous loops launched via `/loop`: the literal sentinel `<<autonomous-loop-dynamic>>`.
- For standard waits where the original `/loop` input should re-fire: pass that input verbatim.
- For non-loop fallbacks (waiting on a remote slice during a normal session): a one-line directive that re-checks the relevant background task, including the host, agent IDs, and the handoff doc path.

What the `reason` field should be (`ScheduleWakeup` only — `CronCreate` lacks this field):

- One specific sentence: which task is being waited on, why this delay.

## R2 — Operating-rule update protocol

Whenever a new operating rule is added (like R1 above) or an existing one needs to change:

1. Update this file in place.
2. Mirror the same rule into the cross-session memory at `/Users/fanye/.claude/projects/<project-hash>/memory/` so future sessions inherit it.
3. Cite the rule's `Rn` identifier in any commit message or handoff that depends on it.

## R3 — Local OpenCode uses companion direct path (BINDING)

When the local Claude root needs a local OpenCode agent (impact analysis, doc edits, quality review, fix passes), invoke `opencode-companion` directly:

```bash
node /Users/fanye/.claude/plugins/marketplaces/my-claude-plugins/skills/opencode-companion/scripts/opencode-companion.mjs \
  session new \
  --directory <project-dir> \
  --agent orchestrator \
  --background \
  --timeout 60 \
  -- "<prompt>"
```

Then poll/wait via `session status <id>`, `session wait <id>`, `session attach <id>`, or `job result <job-id>`.

**Why:** the `paseo run --provider opencode` route works but adds the paseo lifecycle layer (agent id, mode set, --host considerations) that isn't needed for local work. The companion script talks to the OpenCode HTTP serve directly via `.opencode-serve.json`, gives session ids that are first-class for OpenCode (not paseo agent ids), and supports the standard `serve / session / job` verbs cleanly.

**How to apply:**

- LOCAL OpenCode work → `opencode-companion.mjs session new --background --agent orchestrator -- "..."`. Always background for non-trivial tasks.
- REMOTE OpenCode work in a sandbox → `paseo run --host <preview-host>:<port> --provider opencode --model openai/gpt-5.4 --mode orchestrator --thinking high -d ...` (per `feedback_remote_managers_use_opencode` and `feedback_remote_opencode_model`).
- The mcp__paseo__* MCP tools target the local paseo daemon and are appropriate when you specifically want a paseo-managed agent (e.g. one that can spawn sub-paseo workers) — not for ordinary local OpenCode delegation.
- Never spawn agents via `daytona sandbox exec ... paseo run ...` (that breaks notification — see `feedback_remote_managers_use_opencode`).

This supersedes the prior `feedback_opencode_direct_call` memory's defaulting to a `/opencode:task` wrapper — those slash wrappers are removed and the script is the canonical entrypoint.

## R4 — Remote OpenCode managers use local Paseo host routing (BINDING)

When dispatching the remote orchestration tree to the Daytona sandbox, all manager-tier agents (root manager, sub-managers, deeper managers) must be launched as **OpenCode** via `paseo run --provider opencode ...`. Leaves continue to be **OpenCode Companion** sessions. The only Claude in the entire iteration tree is the local root manager (me).

For remote OpenCode managers, expose the remote Paseo daemon through the preview host and launch from the local machine with `paseo run --host <preview> ...`. Never start remote managers by wrapping `paseo run` inside `daytona exec`; `daytona exec` is for lifecycle/bootstrap commands and artifact collection, not manager dispatch.

When dispatching a remote root manager (or sub-manager) on Pluto / Daytona via `paseo run --provider opencode`, always pin the model to `openai/gpt-5.4`, set `--thinking high`, and use `--mode orchestrator`.

## R5 — All OpenCode agents run in orchestrator mode (BINDING)

Memory: all OpenCode manager/agent sessions use `orchestrator` mode unless a scoped handoff explicitly records an exception. Every OpenCode session/agent spawn must run in `orchestrator` mode:

- `paseo run --provider opencode --model openai/gpt-5.4 --mode orchestrator --thinking high ...`
- `opencode-companion.mjs session new --agent orchestrator -- "..."`

**Why:** orchestrator is the most capable mode for OpenCode in this project's setup. Using `build` (default) or `plan` produces weaker reasoning + tool use for the manager-style work we typically delegate.

**How to apply:**

- Default ALL OpenCode spawns to orchestrator mode.
- If a sandbox's `paseo provider ls` shows only `Build, Plan` (orchestrator missing), the orchestrator mode may still be selectable via `--mode orchestrator` even when not listed — try it; if rejected, that's the only case you fall back to `build`.
- Never use `bypassPermissions` mode for OpenCode — earlier attempts showed it can stall the session at startup. Use `build` only as the last fallback.

This supersedes any earlier examples that used `--mode build` for sandbox OpenCode (those were incorrect; build was a fallback that became habit).

## R8 — Live-smoke verification strategy (BINDING)

`pnpm smoke:live` is the slowest verification surface in this repo: ~11+ minutes per run because it spawns real lead/planner/generator/evaluator agents through paseo + opencode + LLM tokens. Re-running it for every small parser/prompt/extractor fix burns 30-45+ minutes per slice (observed in S3+S4+S5).

Hard rules:

1. **`smoke:live` runs ONCE per slice, at the very end.** Treat it as the final regression gate, not a debug loop. After targeted tests + fake smoke are green AND the slice work is conceptually done, run smoke:live once. If it fails, capture the failure as a fixture (rule 2) and continue iterating via the fixture; do NOT re-run smoke:live until a unit test using that fixture proves the fix.

2. **For every live-smoke failure: capture as fixture.** Save the run's `events.jsonl` + `mailbox.jsonl` + relevant run-dir contents under `tests/fixtures/live-smoke/<run-id>/`. The fixture is the new test surface for that failure mode.

3. **For prompt / parser / extractor / handler fixes specifically**: write or extend a unit test that replays the captured fixture through the parser/extractor/handler being fixed. Iterate against the fixture (~single-digit seconds per cycle) until the test goes green. THEN one final smoke:live to confirm end-to-end.

4. **smoke:live re-runs are explicitly NOT allowed during a fix iteration.** If you find yourself wanting to re-run smoke:live after fixing a small format issue, STOP and instead extend a fixture-replay test.

5. **Per-gate timing instrumentation**: each gate command writes start-time + duration to its artifact file (e.g. `gate-<name>.txt` includes a header `# started: <iso-ts>` and `# duration: <seconds>` lines). So timeline reconstruction doesn't require parsing agent thought logs.

6. **R7 still binds independently** (20-min cap per test invocation; targeted-only during fix passes).

**Why:** live smoke is end-to-end real-LLM and probabilistic; small format bugs surface live but the verification cycle is way too heavy for iterative fixing.

**How to apply:**

- Spec / handoff for remote managers: explicitly state R8 + R7 together.
- For in-flight remote managers about to re-run smoke:live for a small fix: send an intervention message stating R8.
- Iterations may need to build a small `tests/fixtures/live-smoke/` infrastructure + fixture-replay helper. That tooling is itself a first-class iteration item; the first slice that needs it should build it, OR list it in the iteration's hardening backlog.

## R6 — v1.6 docs use mailbox-first runtime language (BINDING)

For any repo docs, `.local/manager` docs, PM-space mirror pages, or writeback plans created
after commit `72e063d`, describe Pluto's shipped runtime as:

- mailbox + shared task list + active hooks + plan-approval round-trip
- run-local `mailbox.jsonl` + `tasks.json` as durable evidence lineage (canonical)
- paseo chat is the **target** mailbox transport, wired by the
  `agent-teams-chat-mailbox-runtime` plan Stage B; until that ships, the
  mailbox is a local file-backed mirror only and `paseo chat *` is not on the
  live path

Do not describe the shipped runtime as TeamLead-direct marker dispatch, underdispatch
fallback, or a selectable bridge/fallback lane. Those are historical only.

## R7 — Test time budget per run (BINDING)

Each single test invocation must not exceed **20 minutes** wall-clock. Targeted fix passes should run only the affected test files; reserve **one full-suite run** (`pnpm test`) for the very end of each slice as the regression check.

Hard rules:

1. **20-min cap per `pnpm test` / `pnpm exec vitest run` / `pnpm smoke:*` invocation.** Wrap with `timeout 1200 ...` if there's any risk of hang. If the cap is hit, kill the command and investigate; do NOT keep waiting "just a bit longer."
2. **Targeted-only during fix passes.** When dispatching a focused fix leaf or rerunning after an in-flight correction, run ONLY the test files that exercise the changed code path:
   ```
   timeout 1200 pnpm exec vitest run path/to/affected1.test.ts path/to/affected2.test.ts
   ```
   Don't re-run the full `pnpm test` suite for every fix iteration.
3. **One full suite per slice, at the end.** After all lanes have committed and the targeted test surfaces are green, run `pnpm test` once. That's the slice's regression coverage.
4. If a single test invocation legitimately takes more than 20 minutes, that's a defect signal — fix the test (or the slow code path) before continuing.

**Why:** the `agent-teams-chat-mailbox-runtime` iteration's S3 round burned 5+ hours wall-clock on test loops because the remote manager re-ran full `pnpm test` for every fix. The full suite is ~2 min, but chained through multiple fix rounds + retries blows out budget. Targeted vitest runs for affected files complete in single-digit seconds.

**How to apply:**

- Spec / handoff for remote managers: explicitly state the 20-min cap + targeted-only-during-fix-passes rule.
- For in-flight remote managers running long: send an intervention message with the new constraint.
- For local director Companion sessions reviewing slices: same rule — don't re-run full suite per fix.

Also do not describe `paseo chat` as the *current* mailbox transport in shipped-state
documents — that is the explicit Stage A honesty fix from the
`agent-teams-chat-mailbox-runtime` plan.
