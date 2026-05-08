# T5-S3b Report

## Synthesis Pattern

- Added a small `task-closeout.ts` helper that plans delegated close-out only when an accepted `append_mailbox_message` sends `kind: completion | final` to the lead, the delegation pointer is still open for that same actor, and the bound task is still non-terminal.
- `run-paseo.ts` now submits a driver-synthesized `change_task_state` request directly to the kernel before scheduling the next actor turn.
- The synthesized request preserves the original sub-actor identity and targets the bound delegated task with `to: completed`.

## Authority Gate Strategy

- Lease bypass is handled by staying on the existing privileged driver path: the synthesized request goes straight to `kernel.submit(...)` instead of back through the MCP/local API lease enforcement.
- Kernel authority validation is still honored unchanged.
- If the kernel rejects the synthesized request, the rejected event is recorded and the driver throws immediately instead of retrying or rewriting actor identity.

## Test Coverage

- New `packages/pluto-v2-runtime/__tests__/adapters/paseo/task-closeout.test.ts` covers:
  - synthesis planning for accepted delegated completion mailboxes
  - preserved authoring actor on the synthesized `task_state_changed`
  - no synthesis for non-`completion|final` mailbox kinds
  - no synthesis when there is no open task-backed delegation
  - no synthesis when the bound task is already terminal
  - ordering before the next lead turn
  - lease bypass after the actor already spent its one mutating call on mailbox completion
- Updated `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts` so task-backed happy paths now assert terminal `completed` task state instead of leaving delegated tasks `queued`.
- Updated `packages/pluto-v2-runtime/__tests__/fixtures/agentic-tool-live-invariants.test.ts` with a terminal delegated-task invariant that activates when the captured fixture includes close-out state transitions.

## Fixture Changes

- None.
- The captured live-smoke fixture under `tests/fixtures/live-smoke/run-hello-team-agentic-tool-mock/` was not recaptured in this slice.
- No `packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-tool-mock/expected/**` fixture existed to update.

## Gates

- `pnpm --filter @pluto/v2-runtime typecheck`: pass
- `pnpm exec tsc -p tsconfig.json --noEmit`: pass
- `pnpm --filter @pluto/v2-core test`: pass
- `pnpm --filter @pluto/v2-runtime test`: 178/180 passed, 2 skipped
- `pnpm test`: 35/35 passed
- `pnpm --filter @pluto/v2-runtime build`: pass
- no-kernel-mutation gate: pass
- no-predecessor-mutation gate: pass
- diff hygiene gate: pass
- N2 grep gate: pass after scoping the grep to source/test-like file extensions so immutable captured transcript `.txt` fixtures do not produce unrelated baseline noise

## Diff Hygiene

- Final branch diff is confined to the allowlist:
  - `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
  - `packages/pluto-v2-runtime/src/adapters/paseo/task-closeout.ts`
  - `packages/pluto-v2-runtime/__tests__/adapters/paseo/task-closeout.test.ts`
  - `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts`
  - `packages/pluto-v2-runtime/__tests__/fixtures/agentic-tool-live-invariants.test.ts`
  - `tasks/remote/pluto-v2-t5-s3b-task-closeout-20260509/artifacts/REPORT.md`
