# Context Index — pluto-v2-t1-spec-prompt-view-runtdir-20260508

## Plan + handoff (canonical)

- `docs/plans/active/v2-agentic-orchestration.md` — T1 section
  canonical at HEAD on `main` `d222bb2`.
- `tasks/remote/pluto-v2-t1-spec-prompt-view-runtdir-20260508/HANDOFF.md`
- `tasks/remote/pluto-v2-t1-spec-prompt-view-runtdir-20260508/acceptance.md`
- `tasks/remote/pluto-v2-t1-spec-prompt-view-runtdir-20260508/env-contract.md`
- `tasks/remote/pluto-v2-t1-spec-prompt-view-runtdir-20260508/prompt.md`
- `tasks/remote/pluto-v2-t1-spec-prompt-view-runtdir-20260508/commands.sh`
- `tasks/remote/pluto-v2-t1-spec-prompt-view-runtdir-20260508/context/v2-rewrite-handoff.md`
  (carried from prior bundles; legacy v1.6 handoff)
- `tasks/remote/pluto-v2-t1-spec-prompt-view-runtdir-20260508/context/operating-rules.md`

## Read-only inputs (DO NOT touch)

### v2-core kernel surface — closed, byte-immutable

- `packages/pluto-v2-core/src/protocol-request.ts` — closed
  ProtocolRequest schema (5 intents).
- `packages/pluto-v2-core/src/run-event.ts` — closed RunEvent
  union.
- `packages/pluto-v2-core/src/core/authority.ts` — closed
  authority matrix.
- `packages/pluto-v2-core/src/core/run-kernel.ts` — RunKernel
  pure reducer.
- `packages/pluto-v2-core/src/projections/**` — Task / Mailbox /
  Evidence reducers (use via `replayAll`).

### v2-runtime areas owned by other slices

- `packages/pluto-v2-runtime/src/adapters/paseo/paseo-adapter.ts`
  — T2's territory.
- `packages/pluto-v2-runtime/src/adapters/paseo/paseo-directive.ts`
  — T2.
- `packages/pluto-v2-runtime/scripts/smoke-live.ts` — T3.

### Parity oracle

- `tests/fixtures/live-smoke/86557df1-*` — S4 byte-stable
  parity fixture; UNTOUCHED.

## v2-runtime helpers T1 produces

### NEW

- `packages/pluto-v2-runtime/src/loader/playbook-resolver.ts`
  — markdown playbook loader; returns `{ ref, body, sha256 }`.
- `packages/pluto-v2-runtime/src/adapters/paseo/prompt-view.ts`
  — pure compact-JSON prompt view builder consumed by T2.

### Modified additively

- `packages/pluto-v2-core/src/core/team-context.ts` — schema
  additive fields.
- `packages/pluto-v2-runtime/src/loader/authored-spec-loader.ts`
  — agentic-mode validation.
- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
  — `usageStatus` flag in usage summary builder ONLY. No
  pendingPaseoTurn / phase routing changes.
- `src/cli/v2-cli-bridge.ts` — full run-directory output.
- `src/cli/run.ts` — only if needed for `--run-root` flag plumbing.

## CLI surface affected

- `pnpm pluto:run --spec=<path>` writes `.pluto/runs/<runId>/`
  with the 6 file kinds.

## Re-used infrastructure

- `replayAll(events)` from `@pluto/v2-core` (already exported).
- `EvidencePacketShape` from
  `packages/pluto-v2-runtime/src/evidence/evidence-packet.ts`.
- `formatFinalReport` (or equivalent helper from smoke-live)
  factored out so v2-cli-bridge can call it. May need to lift
  to a shared module under
  `packages/pluto-v2-runtime/src/evidence/`.

## Repository

- GitHub: <https://github.com/atomlink-ye/pluto-agent-platform>
- `main` HEAD: `d222bb2` (T1–T3 plan committed; T1 ready to
  dispatch).
- Prior slice merges: S7 `bb85638→a5a7a11→aca322c→a98fd8d`.

## Reading order

1. `docs/plans/active/v2-agentic-orchestration.md` T1 section.
2. `acceptance.md` (this bundle).
3. `prompt.md` (this bundle).
4. `env-contract.md` (this bundle).
5. `commands.sh` (this bundle).
6. `packages/pluto-v2-core/src/core/team-context.ts` (current
   AuthoredSpecSchema; spec extension target).
7. `packages/pluto-v2-runtime/src/loader/authored-spec-loader.ts`
   (current loader; agentic validation target).
8. `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
   (READ-ONLY except usage summary section).
9. `src/cli/v2-cli-bridge.ts` (current writer; run-directory
   target).
10. `packages/pluto-v2-runtime/scripts/smoke-live.ts` (READ-ONLY;
    reference for usage-summary serializer shape and
    final-report builder we'll lift to shared).
