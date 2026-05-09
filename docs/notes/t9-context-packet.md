# T9 Context Packet — Harness Workflow Hardening

> **Read this first.** This is the shared context for every T9
> slice (T9-S1, T9-S2, T9-S3, T9-S1b deferred). Read this packet
> before the slice's `prompt.md` so you can skip re-exploring the
> repo map, forbidden zones, gate policy, and known noise.

## Repo map (paths you'll likely touch or read)

| Layer | Path | Notes |
|---|---|---|
| **Closed kernel** | `packages/pluto-v2-core/**` | Byte-immutable. `RunEvent` set, `ProtocolRequest` intents, authority matrix all closed. NEVER edit in T9+. |
| Runtime API | `packages/pluto-v2-runtime/src/api/pluto-local-api.ts` | HTTP routes for actors. Touched by S1 (header check), S2 (turnDisposition), S3 (composite routes). |
| Runtime API | `packages/pluto-v2-runtime/src/api/wait-registry.ts` | T9-S2 surface; consume in S3, don't reshape. |
| Runtime API | `packages/pluto-v2-runtime/src/api/composite-tools.ts` | Created by T9-S3. Translation layer for composite verbs → primitive intents. |
| CLI | `packages/pluto-v2-runtime/src/cli/pluto-tool.ts` | All actor-facing subcommands. Touched by every T9 slice. |
| Driver | `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts` | Per-actor turn-state machine (S2), bearer-token issuance, session orchestration. |
| Driver | `packages/pluto-v2-runtime/src/adapters/paseo/actor-bridge.ts` | Run-level CLI binary materialization (S1). |
| Driver | `packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts` | Bootstrap prompts emitted to actors. Updated by every slice. |
| Driver helpers | `wakeup-delta.ts`, `task-closeout.ts`, `bridge-self-check.ts` | T6-T8 surface. CONSUME ONLY in T9+. |
| Tools | `packages/pluto-v2-runtime/src/tools/pluto-tool-handlers.ts` | Kernel-adjacent intent surface. Avoid expanding. |
| Evidence | `packages/pluto-v2-runtime/src/evidence/**` | T6-T8 surface. Read-only in T9+. |
| MCP | `packages/pluto-v2-runtime/src/mcp/**` | Read-only in T9+. |
| Scripts | `packages/pluto-v2-runtime/scripts/smoke-acceptance.ts` | T9-S2 surface (polling-detection check). |
| Scripts | `packages/pluto-v2-runtime/scripts/smoke-live.ts` | T6-T8 surface. Only thread bridge-path emission if a slice needs it. |
| Tests | `packages/pluto-v2-runtime/__tests__/**` | Mirror src layout. |
| Live-smoke fixtures | `tests/fixtures/live-smoke/**` | Captured transcripts. READ-ONLY. |

## Forbidden zones (every T9+ slice)

`git diff --name-only main..HEAD` MUST NOT include:

- `packages/pluto-v2-core/**` (closed kernel)
- `packages/pluto-v2-runtime/src/tools/**` (unless a specific slice carves out exception)
- `packages/pluto-v2-runtime/src/mcp/**`
- `packages/pluto-v2-runtime/src/evidence/**`
- `packages/pluto-v2-runtime/src/adapters/paseo/wakeup-delta.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/task-closeout.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/bridge-self-check.ts`
- `tests/fixtures/live-smoke/**`

If your slice's prompt narrows further (e.g., "don't touch
`actor-bridge.ts`"), respect that on top of this baseline.

## What each merged T9 slice already established

- **T9-S1 (`9e42f54`)**: explicit `--actor` CLI flag, run-level
  binary at `<workspaceCwd>/.pluto/runs/<runId>/bin/pluto-tool`,
  per-actor wrapper as forwarder, server-side
  `Pluto-Run-Actor` header required + actor-set membership check.
  Token-actor cryptographic binding **deferred to T9-S1b**
  (separate slice).
- **T9-S2 (`b48fba0`)**: `turnDisposition`/`nextWakeup` in
  mutation responses (only when `accepted === true`), CLI
  auto-wait on mutating commands, per-actor `ActorTurnState`
  machine, `turn_state_transition` driver traces,
  smoke-acceptance polling-detection (anchored
  `pluto-tool ... <subcommand>` regex, not prose).
- **T9-S3 (in flight, fixup pending)**: composite verbs
  `worker-complete`, `evaluator-verdict`,
  `final-reconciliation` translate server-side into existing
  primitive intents. Closed kernel UNCHANGED. Negative evaluator
  verdicts use `kind=task` (not `completion`) to avoid
  closeout-synthesis collision.

## Gate policy (single source of truth)

Three layers run gates; each layer's responsibility is distinct:

### Layer 1 — Implementer (sandbox agent)
- **Responsibility**: produce the full gate output. Run every
  gate in `commands.sh` and ensure the artifact files in
  `tasks/remote/<slice>/artifacts/gate-*.txt` are populated.
- **Required gates**:
  - `gate_typecheck` → both runtime + root TS
  - `gate_test` → runtime + root vitest
  - `gate_no_kernel_mutation`
  - `gate_no_predecessor_mutation`
  - `gate_no_verbatim_payload_prompts`
  - `gate_diff_hygiene`
- **OOM fallback (don't re-discover each time)**: if
  `pnpm --filter ... typecheck` OOMs, retry with
  `NODE_OPTIONS="--max-old-space-size=8192"` ONCE. If still OOM,
  document in REPORT — that's a harness limit, not a regression.
  Do NOT fall back to running `tsc` directly from `node_modules`
  (the wrapper script is bash; node won't parse it).

### Layer 2 — Reviewer (OC Companion session)
- **First action**: read the implementer's `gate-*.txt`
  artifacts. They tell you whether the gates passed without
  re-running anything.
- **Targeted re-run only**: if you suspect a specific test was
  modified after the artifact was captured, re-run THAT file
  via `pnpm --filter ... exec vitest run <single-file>`. Do
  NOT re-run the full suite by default.
- Subagent delegation is fine — `@oracle` may run gates locally
  if needed.
- Verdict: NO_OBJECTIONS / OBJECTIONS_MECHANICAL / OBJECTIONS_SUBSTANTIVE.

### Layer 3 — Manager (me, in this orchestrator session)
- **Reads OC's verdict only**. Does NOT re-run gates from this
  session — `pnpm` invocation here OOMs the manager process and
  burns context.
- Spot-checks: confirm `git diff --name-only main..HEAD` matches
  reviewer's expected file list; verify a flagged single test
  if reviewer says "this fails."
- ff-merge or dispatch fixup based on OC verdict.

## Known gate noise (DO NOT block on)

These are pre-existing baseline issues, not regressions of any
T9 slice. Implementer should report them but reviewer/manager
should not bounce a fixup back over them:

- **`packages/pluto-v2-core/index.js`** appears as untracked in
  the worktree after `pnpm install --force`. Harmless re-exporter
  baked into pnpm-lock; never commit it.
- **`gate_no_verbatim_payload_prompts`** can hit
  `tests/fixtures/live-smoke/**` captured transcripts. These are
  recordings of past LLM output, not source. The grep regex
  filters `src/` and `__tests__/` but the gate's broader scan
  may catch fixtures — confirm the match isn't in src.
- **`pnpm-lock.yaml` modified** after `pnpm install --force`.
  Don't commit it; it's a known instability.
- **Local typecheck OOM**: see OOM fallback above. Sandbox heap is
  ~4GB; manager-local heap is also ~4GB. Bump to 8GB once if
  needed; document if still failing.

## Build/install quirks

- After `pnpm install --force` in a fresh worktree, restore the
  zod shim:
  ```bash
  cp -RL packages/pluto-v2-runtime/node_modules/zod \
         packages/pluto-v2-core/node_modules/zod
  ```
  (commands.sh has this as `restore_zod_shim` step on T9+)
- `packages/pluto-v2-core/index.js` is a local re-exporter that
  pnpm sometimes drops; harmless, gitignored, don't commit.

## Test entry points

- **Full runtime suite**: `pnpm --filter @pluto/v2-runtime test`
  (vitest, ~228+ tests, 2 skipped baseline)
- **Full root suite**: `pnpm test` (vitest at repo root, ~37 tests)
- **Single file**:
  `pnpm --filter @pluto/v2-runtime exec vitest run __tests__/<path>`
- **Live smoke** (heavy, real LLM, default `gpt-5.4-mini`):
  `pnpm --filter @pluto/v2-runtime exec smoke:live` — once per
  slice, only after typecheck + tests pass.

## Memory rules referenced

- `feedback_no_questions_continue` — never pause to confirm
- `feedback_iterate_until_clean_loop` — full POST-N validation
- `feedback_post_iteration_e2e_validation` — custom workflow + transcript review
- `feedback_delegate_acceptance_fixes` — substantive fixes → fresh OC
- `feedback_remote_first_for_parallelism` — sandbox is default
- `feedback_implementation_via_opencode` — never general-purpose subagents
- `feedback_smoke_live_model` — gpt-5.4-mini default
- `feedback_oc_review_before_manager_check` — OC review FIRST, manager doesn't pre-run gates
- `feedback_oc_subagent_delegation_is_normal` — orchestrator delegating to @oracle is fine; observe via `session status`, never `attach`/cancel
- `feedback_daytona_companion_for_transfer` — daytona-manager.mjs push/pull, not raw `daytona exec`

## Plan doc

Authoritative T9 plan: `docs/plans/active/v2-harness-workflow-hardening.md`.

Per-slice REPORTs at:
`tasks/remote/pluto-v2-t9-<slice>-<YYYYMMDD>/artifacts/REPORT.md`.
