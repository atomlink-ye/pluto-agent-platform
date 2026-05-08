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
- push: failed (`fatal: could not read Username for 'https://github.com': No such device or address`)

## Diff Hygiene

- Final branch diff is confined to the allowlist:
  - `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
  - `packages/pluto-v2-runtime/src/adapters/paseo/task-closeout.ts`
  - `packages/pluto-v2-runtime/__tests__/adapters/paseo/task-closeout.test.ts`
  - `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts`
  - `packages/pluto-v2-runtime/__tests__/fixtures/agentic-tool-live-invariants.test.ts`
  - `tasks/remote/pluto-v2-t5-s3b-task-closeout-20260509/artifacts/REPORT.md`

## Push

- `git push origin pluto/v2/t5-s3b-task-closeout` failed on repository auth.
- Local manager push is still required.

## Fix-up commit

- BLOCKER fix option chosen: **A**.
  - `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts:677-705` now plans close-out before `waitRegistry.notify(...)` and defers mailbox wakeups that will synthesize task completion.
  - `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts:970-1010` now notifies parked waiters with the synthesized `task_state_changed` event on success, or falls back to the queued mailbox event when synthesis is rejected/not used.
- NEEDS_FIX trace marker: `task_closeout_rejected`.
  - Emitted at `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts:991-1004` immediately before the thrown runtime error, and carried on the thrown error's `runtimeTraces` payload.
- NIT test added: `does not plan close-out when completion arrives from a different actor than the open delegation` in `packages/pluto-v2-runtime/__tests__/adapters/paseo/task-closeout.test.ts:346-355`.
- Additional coverage added:
  - parked lead wait payload now asserts both mailbox + synthesized close-out and a post-close-out timeout cursor advance in `packages/pluto-v2-runtime/__tests__/adapters/paseo/task-closeout.test.ts:486-550`
  - synthesized rejection trace emission in `packages/pluto-v2-runtime/__tests__/adapters/paseo/task-closeout.test.ts:552-616`
  - parked wait wake payload assertion updated in `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts:449-520`
- Updated gates:
  - `pnpm --filter @pluto/v2-runtime typecheck`: pass
  - `pnpm exec tsc -p tsconfig.json --noEmit`: pass
  - `pnpm --filter @pluto/v2-runtime test`: 181/183 passed, 2 skipped
  - `pnpm test`: 35/35 passed
  - `pnpm install`: interactive reinstall prompt plus a pre-existing non-interactive `frozen-lockfile` mismatch on this checkout; no repo files were changed to satisfy that environment-only issue
