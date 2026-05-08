# Pluto v2 T2 — acceptance fix-up report

## Sandbox / branch state

- Execution environment: local worktree at `/Volumes/AgentsWorkspace/orgs/atomlink-ye/code/pluto-agent-platform`
- Branch: `pluto/v2/t2-agentic-paseo-adapter`
- Target remote: `origin/pluto/v2/t2-agentic-paseo-adapter`
- Starting branch HEAD: `a300f35`
- Boundary note: Fix 1 used Alternative A (`runPaseo` mode dispatch). No `src/cli/` production-code exception was needed.

## Scope per objection

1. Real CLI path: moved agentic activation to `runPaseo`, with CLI coverage proving `pluto:run --spec=<agentic>` uses the agentic loop.
2. Lead-only completion: sub-actor `complete_run` now routes through rejection handling and returns control to lead.
3. Prompt scrubbing: sub-actor PromptView JSON now replaces `userTask` with `null` before serialization.
4. Deterministic-path stop condition: deterministic adapter tests remain untouched, deterministic-only logic stays isolated, and deterministic path regressions remain green.
5. Additive adapter state: `PaseoAdapterState` is now a single additive interface; agentic fields are optional on the base state and concretized on the agentic branch.
6. Delegation close rules: mailbox-opened delegation only closes on mailbox completion/final-to-lead, not arbitrary terminal task transitions.
7. Parse repair locality: parse-repair is now adapter-local, budgeted, and absent from the persisted event log.

## Closure proofs

- Fix 1: `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts` now dispatches on `authored.orchestration?.mode` and calls `configureAgenticState`; `tests/cli/run-runtime-v2-default.test.ts` proves the real CLI path emits a non-lead-owned `task_created` event.
- Fix 2: `packages/pluto-v2-runtime/src/adapters/paseo/paseo-adapter.ts` only treats `complete_run` as terminal when the current actor is lead; sub-actor attempts now surface through `lastRejection` and continue.
- Fix 3: `packages/pluto-v2-runtime/src/adapters/paseo/agentic-prompt-builder.ts` sanitizes sub-actor PromptView JSON; `agentic-prompt-builder.test.ts` asserts lead keeps the literal task while sub-actors see `"userTask": null`.
- Fix 4: `packages/pluto-v2-runtime/__tests__/adapters/paseo/paseo-adapter.test.ts` remains byte-untouched on the branch, and deterministic runtime tests still pass.
- Fix 5: `packages/pluto-v2-runtime/src/adapters/paseo/paseo-adapter.ts` now exports a single additive `PaseoAdapterState` base interface with refined deterministic/agentic views.
- Fix 6: `packages/pluto-v2-runtime/src/adapters/paseo/agentic-scheduler.ts` requires a non-null `delegationTaskId` to close task-opened delegation; scheduler tests cover mailbox-opened, task-opened, and mailbox-completion cases.
- Fix 7: `packages/pluto-v2-runtime/src/adapters/paseo/paseo-adapter.ts` plus `run-paseo.ts` now keep parse repair entirely adapter-local via `pendingRepairPrompt` + `bypassKernelRequest`; runtime tests assert no repair event is persisted.

## Boundary / grep / regression checks

- Core boundary diff gate: clean
- Runtime loader/evidence/prompt-view/smoke-live/`src/cli` boundary gate: clean
- S4 parity fixture boundary gate: clean
- Deterministic adapter test diff vs `main`: empty
- Verbatim-payload prompt grep gate: clean (`agentic-prompt-builder.ts` and `agentic-*.test.ts`)

## Validation performed

- `pnpm --filter @pluto/v2-core typecheck`
- `pnpm --filter @pluto/v2-runtime typecheck`
- `pnpm exec tsc -p tsconfig.json --noEmit`
- `pnpm --filter @pluto/v2-core test`
- `pnpm --filter @pluto/v2-runtime test`
- `pnpm test`
- `pnpm --filter @pluto/v2-core build`
- `pnpm --filter @pluto/v2-runtime build`

All green locally.

## Independent review loop

- Prior acceptance state: `NEEDS_FIX` with 7 substantive objections.
- Post-fix oracle review in this session: PASS on all 7 objections; no remaining blockers identified.

## Files changed

- `packages/pluto-v2-runtime/src/adapters/paseo/paseo-adapter.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/agentic-prompt-builder.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/agentic-scheduler.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/agentic-loop-state.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-loop.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-prompt-builder.test.ts`
- `packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-mock/scenario.yaml`
- `packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-mock/playbook.md`
- `tests/cli/run-runtime-v2-default.test.ts`
- `tasks/remote/pluto-v2-t2-agentic-paseo-adapter-20260508/artifacts/REPORT.md`
