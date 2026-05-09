# T12 Context Packet — Pluto v2 Harness Polish

This packet co-locates with the T12 plan
(`docs/plans/active/v2-harness-polish-gpt-pro-followups.md`).
Every T12 slice prompt should reference this file FIRST so the
repo-facing surface map and forbidden zones are amortized.

## Surface map (at predecessor `b33a1ff6`)

### Closed kernel — DO NOT MODIFY

`packages/pluto-v2-core/src/**` is byte-immutable for this
iteration. Only `packages/pluto-v2-core/src/index.ts` may
receive ADDITIVE re-exports (T10-S3 precedent).

The closed kernel today owns:
- `actor-ref.ts` — `ACTOR_ROLE_VALUES` / `ActorRef` (closed enum).
- `core/` — `RunKernel`, `RunEventLog`, `team-context`.
- `projections/` — closed projection set.
- `protocol-request.ts` — closed intent set: `create_task`,
  `change_task_state`, `append_mailbox_message`,
  `publish_artifact`, `complete_run`.
- `run-event.ts` — closed event set.

If a slice "needs" to widen the closed enum or add a new event
kind, escalate — do not edit kernel sources.

### Runtime layer — open for change

`packages/pluto-v2-runtime/src/`:
- `adapters/paseo/run-paseo.ts` — control-plane orchestrator
  (manager-run-harness, mailbox sweep, ActorTurnState, silent
  re-arm).
- `adapters/paseo/actor-bridge.ts` — materializes actor wrapper
  + run-level binary; today calls `tsx --tsconfig ... pluto-tool.ts`.
- `adapters/paseo/agentic-tool-prompt-builder.ts` — bootstrap
  prompt assembly (lead, generator, evaluator, custom roles).
  T11-S1 anchor language lives here.
- `api/composite-tools.ts` — TeamProtocol composite verbs
  (`worker-complete`, `evaluator-verdict`, `final-reconciliation`).
  Today translates server-side to primitive intents only.
- `api/pluto-local-api.ts` — HTTP route layer; per-actor token
  binding lives here (T9-S1b).
- `cli/pluto-tool.ts` — actor-facing CLI. Today executed via `tsx`.
- `tools/pluto-tool-handlers.ts` — handler implementations.
- `mcp/pluto-mcp-server.ts` — MCP server adapter.

### Evidence / projections

Today the runtime writes to `<runDir>/evidence/` and
`<runDir>/state/`. There is currently NO `final-reconciliation`
projection on disk; only the kernel's primitive
`complete_run` event records the summary.

### Tests

- `packages/pluto-v2-core/__tests__/**` — kernel.
- `packages/pluto-v2-runtime/__tests__/**` — runtime adapters,
  composite tools, CLI, prompt builder, smoke acceptance.
- Root `__tests__/**` — integration / lint guards.

### Bundle / build

Currently no compiled CLI artifact. `pnpm pluto:run` and
`pnpm smoke:live` use `tsx` directly. Actor wrapper script
also uses `tsx`. Root deps include `tsup`, `tsc`, `tsx`.

### Live-smoke fixtures

- Hello-team agentic-tool mock at
  `packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-tool-mock/`.
- Canonical real-LLM scenario at
  `/Volumes/AgentsWorkspace/tmp/pluto-symphony-custom-test/symphony/`
  (used for POST-N validation, NOT in repo).

## Status at start of T12

- main HEAD: `b33a1ff6`.
- T9–T11 arc closed PASS 6/6.
- Active plans (untouched, NOT part of T12):
  - `full-product-shape-hardening.md`
  - `pluto-paseo-docs-as-config-refactor.md`
  - `runtime-helper-paseo-live-hello-team.md`
  - `runtime-helper-plan-approval-mailbox-evidence.md`

## Build / typecheck quirks (carry-over from T9–T11)

- Cold `pnpm typecheck:src` from a fresh container can OOM
  in some sandbox conditions. The split src/test configs
  (T9-S5) plus T10-S3 source-boundary cleanup made this
  much better, but still a known soft spot. Single-attempt
  discipline: do NOT retry typecheck with
  `--max-old-space-size`; capture the failure, document,
  continue.
- Don't invoke `./node_modules/.bin/tsc` directly — it's a
  bash wrapper, not Node-loadable. Use `pnpm typecheck` or
  `pnpm exec tsc`.

## Test entry points

- `pnpm --filter @pluto/v2-core test`
- `pnpm --filter @pluto/v2-runtime test`
- `pnpm test` (root, includes integration + lint guards).
- `pnpm smoke:live --spec <fixture>` (LLM live; mocked or
  Symphony scenario).

## Build entry points (relevant for S2)

- `pnpm typecheck` — full build typecheck.
- No existing `pnpm build` for the runtime CLI. S2 will
  add one.

## Where each P-priority lands

| P | Slice | Files | Type |
|---|---|---|---|
| P0 | S1 | README, docs/harness, prompt-builder, T9 plan note | doc-only |
| P1 | S2 | actor-bridge.ts, build config, package.json | runtime |
| P2 | S3 | composite-tools.ts, new audit helper, evidence emit | runtime |
| P4 | S4a | new src/cli/runs.ts | runtime |
| P4 | S4b | runs.ts (audit subcommand, after S3) | runtime |

## Don't touch

- `packages/pluto-v2-core/src/**` (kernel byte-immutable).
- `legacy-v1.6-harness-prototype` branch.
- Active plans not listed in T12 scope.
- Symphony fixture (read-only at validation).
