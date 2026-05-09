# T9 — Harness Workflow Hardening: surface map and status

Index of code paths, forbidden zones, and current iteration state
for the T9 (Harness Workflow Hardening) work. Read this alongside
[`docs/plans/active/v2-harness-workflow-hardening.md`](../plans/active/v2-harness-workflow-hardening.md)
when working on any T9 slice.

## Code map (paths you'll likely touch or read)

| Layer | Path | Notes |
|---|---|---|
| **Closed kernel** | `packages/pluto-v2-core/**` | Byte-immutable. `RunEvent` set, `ProtocolRequest` intents, authority matrix all closed. Not editable in T9+. |
| Runtime API | `packages/pluto-v2-runtime/src/api/pluto-local-api.ts` | HTTP routes for actors. Touched by S1 (header check), S2 (turnDisposition), S3 (composite routes). |
| Runtime API | `packages/pluto-v2-runtime/src/api/wait-registry.ts` | T9-S2 surface; consumed by S3, not reshaped. |
| Runtime API | `packages/pluto-v2-runtime/src/api/composite-tools.ts` | Created by T9-S3. Translation layer for composite verbs → primitive intents. |
| CLI | `packages/pluto-v2-runtime/src/cli/pluto-tool.ts` | All actor-facing subcommands. Touched by every T9 slice. |
| Driver | `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts` | Per-actor turn-state machine (S2), bearer-token issuance, session orchestration. |
| Driver | `packages/pluto-v2-runtime/src/adapters/paseo/actor-bridge.ts` | Run-level CLI binary materialization (S1). |
| Driver | `packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts` | Bootstrap prompts emitted to actors. Updated by every slice. |
| Driver helpers | `wakeup-delta.ts`, `task-closeout.ts`, `bridge-self-check.ts` | T6-T8 surface. Consume only in T9+. |
| Tools | `packages/pluto-v2-runtime/src/tools/pluto-tool-handlers.ts` | Kernel-adjacent intent surface. Avoid expanding. |
| Evidence | `packages/pluto-v2-runtime/src/evidence/**` | T6-T8 surface. Read-only in T9+. |
| MCP | `packages/pluto-v2-runtime/src/mcp/**` | Read-only in T9+. |
| Scripts | `packages/pluto-v2-runtime/scripts/smoke-acceptance.ts` | T9-S2 surface (polling-detection check). |
| Scripts | `packages/pluto-v2-runtime/scripts/smoke-live.ts` | T6-T8 surface. Only thread bridge-path emission if a slice needs it. |
| Tests | `packages/pluto-v2-runtime/__tests__/**` | Mirror the `src` layout. |
| Live-smoke fixtures | `tests/fixtures/live-smoke/**` | Captured transcripts. Read-only. |

## Forbidden zones (no diff in `main..HEAD` for any T9+ slice)

- `packages/pluto-v2-core/**` (closed kernel)
- `packages/pluto-v2-runtime/src/tools/**` (unless a specific slice carves out exception)
- `packages/pluto-v2-runtime/src/mcp/**`
- `packages/pluto-v2-runtime/src/evidence/**`
- `packages/pluto-v2-runtime/src/adapters/paseo/wakeup-delta.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/task-closeout.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/bridge-self-check.ts`
- `tests/fixtures/live-smoke/**`

A slice's own prompt may narrow further on top of this baseline.

## Current iteration status

- **T9-S1 — unified actor CLI** (merged at `9e42f54`): explicit
  `--actor` CLI flag, run-level binary at
  `<workspaceCwd>/.pluto/runs/<runId>/bin/pluto-tool`, per-actor
  wrapper as forwarder, server-side `Pluto-Run-Actor` header
  required + actor-set membership check. Token-actor
  cryptographic binding deferred to a follow-up T9-S1b slice.
- **T9-S2 — wait as turn lifecycle** (merged at `b48fba0`):
  `turnDisposition`/`nextWakeup` in mutation responses (only
  when `accepted === true`), CLI auto-wait on mutating commands,
  per-actor `ActorTurnState` machine, `turn_state_transition`
  driver traces, smoke-acceptance polling-detection (anchored
  `pluto-tool ... <subcommand>` regex, not prose).
- **T9-S3 — TeamProtocol composite tools** (in flight): composite
  verbs `worker-complete`, `evaluator-verdict`,
  `final-reconciliation` translate server-side into existing
  primitive intents. Closed kernel UNCHANGED. Negative evaluator
  verdicts use mailbox `kind=task` (not `completion`) to avoid
  the close-out synthesis collision.
- **T9-S1b — per-actor token binding** (deferred from S1): per-
  actor bearer-token issuance in `run-paseo.ts`, token registry
  keyed by actor, route validates `Authorization: Bearer <token>`
  is bound to the actor named in `Pluto-Run-Actor` header,
  emits 403 `actor_mismatch` on divergence.

Per-slice REPORTs at:
`tasks/remote/pluto-v2-t9-<slice>-<YYYYMMDD>/artifacts/REPORT.md`.

## Known gate noise (pre-existing baseline, NOT a T9 regression)

- `packages/pluto-v2-core/index.js` appears as untracked in the
  worktree after `pnpm install --force`. Harmless re-exporter
  baked into `pnpm-lock.yaml`; never commit it.
- `gate_no_verbatim_payload_prompts` may match
  `tests/fixtures/live-smoke/**` captured transcripts. These are
  recordings of past LLM output, not source — confirm any match
  is in fixtures and not in `src/` or `__tests__/`.
- `pnpm-lock.yaml` is sometimes modified after
  `pnpm install --force`. Don't commit it.
- Runtime typecheck fast path is
  `pnpm --filter @pluto/v2-runtime typecheck:src`. If a
  typecheck exits 137 (`Killed` / sandbox cgroup OOM-killer) or
  aborts with a fatal Node heap OOM, record it once, treat it as
  a harness limit, and continue with other gates. Do not retry with
  `NODE_OPTIONS="--max-old-space-size=8192"`, and do not invoke
  `node_modules/.bin/tsc` directly.

## Build / install quirks

- After `pnpm install --force` in a fresh worktree, restore the
  zod resolution shim (the `commands.sh` bundle for T9+ slices
  has this as a `restore_zod_shim` step):
  ```bash
  cp -RL packages/pluto-v2-runtime/node_modules/zod \
         packages/pluto-v2-core/node_modules/zod
  ```
- `packages/pluto-v2-core/index.js` is a local re-exporter that
  pnpm sometimes drops; gitignored, not committed.

## Test entry points

- **Full runtime suite**: `pnpm --filter @pluto/v2-runtime test`
  (vitest, ~228+ tests, 2 skipped baseline)
- **Runtime typecheck fast path**:
  `pnpm --filter @pluto/v2-runtime typecheck:src`
- **Runtime typecheck full split**:
  `pnpm --filter @pluto/v2-runtime typecheck:test`
- **Full root suite**: `pnpm test` (vitest at repo root, ~37 tests)
- **Single file**:
  `pnpm --filter @pluto/v2-runtime exec vitest run __tests__/<path>`
- **Live smoke** (heavy, real LLM): default model is
  `openai/gpt-5.4-mini`. Run via
  `pnpm --filter @pluto/v2-runtime exec smoke:live` — once per
  slice, only after typecheck + tests pass.

## Plan doc

Authoritative T9 plan: [`docs/plans/active/v2-harness-workflow-hardening.md`](../plans/active/v2-harness-workflow-hardening.md).
