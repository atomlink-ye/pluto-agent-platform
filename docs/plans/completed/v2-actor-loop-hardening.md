# Pluto v2 — Actor Loop Hardening (T5)

> [!NOTE]
> **Per-slice reports** (in execution order):
> - [T5-S1 — stable actor API + `pluto-tool` CLI + env handoff](../../../tasks/remote/pluto-v2-t5-s1-stable-actor-api-20260508/artifacts/REPORT.md)
> - [T5-S2a — bootstrap once + minimal wakeup deltas](../../../tasks/remote/pluto-v2-t5-s2a-prompt-thinning-20260508/artifacts/REPORT.md)
> - [T5-D2b — wait feasibility spike (verdict GO)](../../../tasks/remote/pluto-v2-t5-d2b-wait-feasibility-20260508/artifacts/REPORT.md)
> - [T5-S2b — wait registry + dual-mode delivery](../../../tasks/remote/pluto-v2-t5-s2b-wait-registry-20260509/artifacts/REPORT.md)
> - [T5-S3a — residual P1 cleanup](../../../tasks/remote/pluto-v2-t5-s3a-residual-p1-20260509/artifacts/REPORT.md)
> - [T5-S3b — driver-synthesized task close-out](../../../tasks/remote/pluto-v2-t5-s3b-task-closeout-20260509/artifacts/REPORT.md)
> - [T5-S4 — `mode: orchestrator` + `initiatingActor` audit](../../../tasks/remote/pluto-v2-t5-s4-p2-polish-20260509/artifacts/REPORT.md)
>
> **Successor plan:** [T6 actor bridge fix](v2-actor-bridge-fix.md) (POST-T5 validation surfaced decorative env handoff + missing `pluto-tool` PATH)

> **Status:** ready, 2026-05-08. Awaiting first dispatch.
> **Authority:** this file is the canonical plan for T5. Conflicts with
> bundle docs / future acceptance files → plan wins.
> **Inputs:**
> - End-to-end behavioral analysis (`task-e11a7e-18aa8e`) of the
>   freshly-merged `v2-mcp-tool-driven-agentic-loop` iteration.
> - Local manager Direct testing on a custom `poet/critic` haiku
>   workflow (rejected by closed role enum) + sanity rerun on
>   `hello-team-agentic-tool-mock`.
> - `@oracle` Discovery review (`task-4105e8-a220dc`,
>   verdict NEEDS_REVISION → resolved by this plan's slice cut).
> - Predecessor plans:
>   `docs/plans/completed/v2-mcp-tool-driven-agentic-loop.md`,
>   `docs/plans/completed/v2-agentic-orchestration.md`.

## Why T5 exists

T4 shipped the kernel + tool surface + MCP server + driver swap + live
fixture. Behavioral analysis then revealed the *actor-facing* contract
is **decorative**:

- Even on the captured sandbox fixture, every actor (lead, generator,
  evaluator) spent its first turn doing `[Bash] curl + hand-rolled
  JSON-RPC` to invoke Pluto tools. The opencode.json injection
  delivered the URL but left the bearer token in a file the actor had
  to grovel for, and left the required `pluto-run-actor` HTTP header
  totally undocumented.
- Every turn rebuilds a full prompt (playbook + userTask + tool list +
  full PromptView JSON). Captured: 3 lead prompts at 2615 / 3124 /
  3647 chars; **1793 chars of static scaffold duplicated each turn**.
- Tasks stayed `queued` after a "successful" run because the
  one-mutating-call-per-turn rule forces sub-actors to choose
  mailbox-completion over `change_task_state`.
- `process.cwd()` is used to derive the actor injection dir, ignoring
  `--workspace`.
- `mode` is hardcoded `'build'` (R5 says `orchestrator`).
- `run_completed` event records `actor: manager` even when lead
  initiated it (audit trail loss).
- Role enum closed at `{lead, planner, generator, evaluator}` —
  user-defined `poet`/`critic` roles rejected.

Architecturally the lead-driven orchestration **is real** (events.jsonl
shows clean lead-led delegation + manager-synthesized close), but the
mechanism for actors to participate is wrong: they are not OpenCode
MCP tool users, they are bash + curl users discovering an
under-documented HTTP API.

T5 fixes this by changing the actor contract to a **stable
local CLI + HTTP API + env handoff** (S1), then thinning the
per-turn prompt (S2a), proving feasibility before adding true
wait/suspension semantics (D2b → S2b), fixing the residual
P1 surface (S3a), giving task close-out a deliberate semantic
(S3b), polishing P2 (S4), and deferring open-role schema
(S5, separate contract slice).

## Hard architecture decisions

(Adopting `@oracle` recommendations 2026-05-08 verbatim.)

1. **`pluto-tool` CLI + stable localhost HTTP API is the canonical
   actor contract.** MCP server stays as the internal transport
   backend; the wrapper hits it. Actors are prompted with the **exact
   call shape** as a one-liner, not "bearer auth is preconfigured".

2. **Closed v2-core kernel surface stays byte-immutable** through
   T5. No new event kinds, no payload-schema changes. New
   tooling lives in v2-runtime.

3. **Env handoff** for actor identity:
   - `PLUTO_RUN_API_URL=http://127.0.0.1:<port>/v1`
   - `PLUTO_RUN_TOKEN=<bearer>`
   - `PLUTO_RUN_ACTOR=role:lead` (or `role:generator`, etc.)
   The wrapper CLI reads these; actors never need to know them.

4. **First-spawn full bootstrap, subsequent turns event-driven only**:
   bootstrap prompt = playbook + userTask + tool list + initial
   PromptView; subsequent prompts = minimal wakeup ("new event:
   `<kind>`, your turn") OR (S2b) wait-unblock with single event +
   actor-visible delta.

5. **Wait is opt-in, with cursor + atomic arm/park.** Actor calls
   `pluto_wait_for_event` (in S2b only); server tracks per-actor
   event cursor; arm-then-park is atomic; pending events between
   waits return on next wait without loss. Single in-flight wait
   per actor.

6. **Task close-out via deliberate semantic, NOT lease relaxation**:
   either explicitly allow a bounded close-out group (`change_task_state
   to: completed` + `append_mailbox_message kind: completion to: lead`
   in one atomic turn extension), OR have the driver synthesize a
   `change_task_state to: completed` when accepting a mailbox
   `kind: completion` from the bound delegated actor. Operator decides
   in S3b discovery; default to driver-synthesized.

7. **Open role schema is a contract slice** (S5), not polish.
   Affects policy / validation / fixtures / docs beyond one file.
   Defer to its own iteration if S1-S4 land first.

## Slice decomposition

7 actionable slices in T5; S5 deferred.

### T5-S1 — Stable actor API (CLI + HTTP + env handoff)

**Goal:** make the actor contract usable. Actors no longer grovel for
tokens or hand-roll JSON-RPC.

**Deliverables:**

- **New** `packages/pluto-v2-runtime/src/api/pluto-local-api.ts` —
  stable HTTP API surface mirroring the 8 MCP tools. Auth via
  `Authorization: Bearer <token>` + `Pluto-Run-Actor: <ref>`. Same
  127.0.0.1-only bind + bearer + lease semantics as the MCP server.
  May be implemented as a wrapper that reuses the MCP server's tool
  handlers under the hood (zero-duplication).
- **New** `packages/pluto-v2-runtime/src/cli/pluto-tool.ts` — thin
  Node CLI binary `pluto-tool`. Reads `PLUTO_RUN_API_URL` /
  `PLUTO_RUN_TOKEN` / `PLUTO_RUN_ACTOR` from env. Subcommands:
  - `pluto-tool create-task --owner=<role> --title=<...> [--depends-on=...]`
  - `pluto-tool change-task-state --task-id=<id> --to=<state>`
  - `pluto-tool send-mailbox --to=<role|manager> --kind=<kind> --body=<...>`
  - `pluto-tool publish-artifact --kind=<final|intermediate> --media-type=<...> --body=<...>`
  - `pluto-tool complete-run --status=<...> --summary=<...>`
  - `pluto-tool read-state` / `read-artifact` / `read-transcript`
  Output: JSON (default) or `--format=text` for human glance.
- **Modify** `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`:
  - Fix line 443: derive `actorDir` from `args.workspaceCwd`, NOT
    `process.cwd()`. Same for `runRootDir` (line 495).
  - Drop the `opencode.json` MCP injection step. Replace with: write
    a small `.pluto-run.env` file in the per-actor cwd, OR pass the
    three env vars directly via `paseoCli.spawnAgent({ env })`.
  - Bootstrap prompt now includes the **exact `pluto-tool` call
    shape** for each tool.
- **Modify** `src/cli/v2-cli-bridge.ts`: line 80-95 — `buildPaseoAgentSpec`
  passes the env handoff to spawnAgent.
- **Modify** `packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts`:
  - Replace the "Pluto MCP endpoint:" block with a "How to call
    Pluto tools:" block that shows literal `pluto-tool` invocations.
  - Drop "bearer auth is preconfigured" hand-wave; actors never see
    raw tokens or headers in normal operation.

**Tests:**
- `__tests__/api/pluto-local-api.test.ts` — HTTP API end-to-end
  (auth, lease, all 8 tools, error shapes).
- `__tests__/cli/pluto-tool.test.ts` — CLI argv parsing + subprocess
  shell-out test (env handoff propagation).
- Update `__tests__/adapters/paseo/agentic-tool-prompt-builder.test.ts`
  to assert the new "exact call shape" content.
- New live-smoke invariant: lead transcript MUST contain
  `pluto-tool` invocations and MUST NOT contain `curl` or
  `mcporter` for Pluto MCP discovery.

**Acceptance:**
- Captured live fixture (re-run): lead/sub-actors invoke `pluto-tool`
  natively; first-mutation-time drops materially below the 132s
  baseline.
- All gates green; closed v2-core schemas untouched.
- `process.cwd()` no longer appears in the per-actor cwd derivation.

**Cost (revised):** ~350-600 LOC, 4-6 src + 4-6 tests.

**Stop conditions:**
- The `pluto-tool` wrapper still requires actors to know
  bearer/header internals in normal operation. → revisit env
  handoff design.
- Live-smoke shows actors STILL falling back to curl. → the issue
  is in the prompt, not the API; tighten prompt language.

### T5-S2a — Prompt thinning (high-value, low-risk)

**Goal:** stop the wasteful full-prompt rerender every turn. Bootstrap
once; subsequent turns get minimal wakeup prompts.

**Deliverables:**
- **Modify** `run-paseo.ts` `runAgenticToolLoop`:
  - First spawn: full bootstrap prompt as today.
  - Subsequent turns: send only `wakeupPrompt(latestEvent,
    actorVisibleStateDelta)` — a one-line "new event: `<kind>`,
    your turn" plus a small JSON delta of changed tasks/mailbox/
    delegation since last wakeup. NO playbook, NO userTask, NO full
    PromptView, NO tool list rerender.
  - Track per-actor `lastWakeupEventCursor` (event sequence number)
    for the delta computation.
- **Modify** `agentic-tool-prompt-builder.ts`:
  - Add `buildWakeupPrompt({ event, delta, actor })` returning a
    short string.
  - Existing `buildAgenticToolPrompt` becomes the bootstrap-only
    variant.

**Tests:**
- New `__tests__/adapters/paseo/wakeup-prompt-builder.test.ts`:
  bootstrap vs wakeup prompt sizes; delta correctness; cursor
  monotonicity.
- Update `agentic-tool-loop.test.ts`: assert turn-2+ prompts contain
  no static scaffold (no playbook heading, no "Available Pluto
  tools" block, no "Never delegate understanding" line).
- New live-smoke invariant: per-turn prompt size after turn 1 is
  ≤ 30% of the bootstrap prompt size.

**Acceptance:**
- Captured live fixture re-run: lead turn 2/3 prompts are <500
  chars (vs 3124/3647 today).
- Behavior unchanged: same event sequence, same final state.

**Cost:** ~180-320 LOC, 3-5 files.

**Stop conditions:**
- Actor cannot reason correctly without the full prompt context →
  expand wakeup delta until it can, but never re-include playbook
  unless agent explicitly requests via `pluto_read_state` /
  `pluto-tool read-state`.

### T5-D2b — Feasibility spike for true wait/suspension

**Goal:** prove (or disprove) that long-poll-style tool calls in
OpenCode + Paseo can support a server-side wait registry without
blocking the driver's ability to advance other actors.

**Throwaway proof script** at
`packages/pluto-v2-runtime/scripts/smoke-wait-feasibility.ts`:
1. Start MCP server with a stub `pluto_wait_for_event(timeoutSec)`
   tool that blocks for 30s then returns.
2. Spawn 2 OpenCode actors (lead + generator) via paseo. Lead
   immediately calls the stub wait. Generator concurrently makes a
   simple read-tool call.
3. Verify: generator's read-tool returns within 1s while lead is
   still parked in wait. Lead's wait returns at 30s.
4. Repeat with cancellation: kill the lead's wait via
   `paseo agent stop`; verify generator session keeps progressing.
5. Document: which timeouts (`paseo wait`, OpenCode tool-call,
   server-side, MCP-protocol) are in play; which one bites first.

**Deliverable:** `docs/notes/t5-d2b-wait-feasibility.md` — record
which approach works, which doesn't, and the recommendation for S2b
(go / no-go / partial).

**Stop condition:** if wait blocks the scheduler that produces the
wake event → S2b is infeasible as designed; T5-S2b becomes a
narrower "actor-side polling against state cursor" instead of
true server-side push.

**Cost:** ~150-300 LOC, 2-3 files (proof script + write-up).

### T5-S2b — Wait registry + unblock path (CONDITIONAL on D2b)

**Goal:** add `pluto_wait_for_event` as the actor's preferred suspend
primitive. Driver pushes events into waited windows.

**Deliverables (conditional shape):**
- **New** `packages/pluto-v2-runtime/src/api/wait-registry.ts` — per-
  actor wait registry, atomic arm/park with event cursor, single
  in-flight wait per actor.
- **Add** to MCP server + HTTP API: `pluto_wait_for_event` tool.
- **Add** `pluto-tool wait [--timeout=300]` subcommand.
- **Modify** `run-paseo.ts`: the dual-mode delivery — if actor in
  wait, unblock; else minimal wakeup prompt (S2a fallback path).
- **Add observability**: trace events `wait_armed`, `wait_unblocked`,
  `wait_timed_out`, `wait_cancelled` (on shutdown / actor delete /
  run abort).
- **Cancellation paths**: pending waits released on run completion,
  abort, shutdown, actor deletion.

**Tests:**
- `__tests__/api/wait-registry.test.ts` — atomic arm/park, cursor,
  multi-event accumulation, single-flight enforcement.
- `__tests__/api/wait-cancellation.test.ts` — every cancellation
  path releases pending waits cleanly.
- Live-smoke: lead transcript shows `pluto-tool wait` invocations
  between turns; total tokens drop further vs S2a baseline.

**Acceptance:**
- All gates green.
- D2b's recommendation honored.
- No deadlocks observed in stress test (10 actors, 5 concurrent
  waits, all eventually unblock or timeout cleanly).

**Cost:** ~700-1200 LOC, 6-9 files.

**Stop conditions:**
- D2b returns no-go → land only S2a; mark S2b as deferred to a
  future iteration.
- Cursor + atomic-arm-park can't be expressed without kernel
  changes → BLOCKED.

### T5-S3a — Residual P1 cleanup

**Goal:** mop up any P1 surface S1 + S2a didn't already absorb.

**Deliverables:**
- Verify no remaining `process.cwd()` / `--workspace`-ignoring
  paths anywhere in v2-runtime.
- Doc updates: `docs/harness.md` actor-API section, README example
  showing `pluto-tool` workflow.
- If any test still manually injects `Pluto-Run-Actor` header
  (the analysis flagged `tests/cli/run-runtime-v2-default.test.ts:67-71`),
  refactor to use the canonical CLI/wrapper path.

**Cost:** ~100-180 LOC, 2-4 files.

### T5-S3b — Task close-out semantic

**Goal:** make tasks reach a terminal state when the run is
"successful". Today they stay `queued` because the one-mutating-
call-per-turn rule forces a binary choice.

**Decision:** driver-synthesized close-out (default).

When the driver receives an accepted `mailbox_message_appended` with
`kind: completion | final` from the bound delegated actor to lead,
AND the delegation pointer is still open against a `task_created`
event, the driver synthesizes a `change_task_state to: completed`
ProtocolRequest authored by the same actor (matching the bound
task) before yielding control back to the lead.

**Alternative (rejected):** relax the lease consume to allow N
mutating calls per turn. Conflicts with `turn-lease.ts:22-47` design;
oracle flagged this.

**Deliverables:**
- **Modify** `run-paseo.ts`: add the synthesis step in the agentic_tool
  lane. Bypass lease via a privileged "driver synthesis" path
  (similar to manager-synthesized `complete_run`).
- **Modify** `pluto-tool-handlers.ts` (S1) if needed for the
  synthesis path.

**Tests:**
- New `__tests__/adapters/paseo/task-closeout.test.ts`: mailbox
  completion → task auto-completes.
- Live-smoke invariant: at end of run, all delegated tasks are in
  a terminal state (completed / cancelled / failed).

**Cost:** ~250-500 LOC, 3-5 files.

**Stop condition:** synthesis path conflicts with authority matrix
in a way that requires v2-core changes → STOP, surface BLOCKED.

### T5-S4 — P2 polish (orchestrator mode + run_completed audit)

**Goal:** the small but visible stuff.

**Deliverables:**
- Switch `mode: 'build'` → `'orchestrator'` in `buildPaseoAgentSpec`
  (`src/cli/v2-cli-bridge.ts:83`). If sandbox lacks orchestrator
  mode at runtime, fall back to `build` with a logged warning.
- Preserve initiating actor in `run_completed` audit trail. Kernel
  event `actor` stays `manager` for authority correctness, but add
  an `initiatingActor: ActorRef` field to evidence packet and
  final-report.md so the audit shows lead triggered the close.

**Cost:** ~100-250 LOC, 2-4 files.

**NOT in S4 (deferred to S5):** opening the role enum.

### T5-S5 (deferred) — Open role schema (contract slice)

**Goal:** allow user-defined roles like `poet`, `critic`, `compiler`,
`reviewer` in actor specs.

This is a separate contract slice. Affects:
- `packages/pluto-v2-core/src/actor-ref.ts` — `ActorRoleSchema`
  becomes `z.string().min(1)`.
- Authority matrix and policy validation must still gate.
- Fixtures, docs, tests across the codebase that hardcode the
  4-role set.

**Cost:** ~400-800 LOC, 4-8 files.

**Status:** **DEFERRED**. Operator approves separately when T5-S1
through T5-S4 land. Until then, users must alias custom roles to
the existing 4-role enum (documented in S3a's docs update).

## Risk register (per @oracle)

1. **Deadlock in S2b**: long-poll wait may block the very scheduler
   needed to produce the wake event. → D2b spike gates.
2. **Lost wakeups**: arm-then-park must be atomic with cursor check.
3. **Double delivery**: dedup by event sequence cursor.
4. **Tool/session timeout mismatch**: wait timeout ≤ runtime
   tool-call timeout cap.
5. **Single-flight session assumptions**: must prove blocked actor
   doesn't prevent other sessions (D2b).
6. **Double-wait semantics**: explicit reject + clear error.
7. **Cancellation paths**: every cleanup case releases waits.
8. **Task close-out lease conflict**: handled via driver-synthesized
   path (S3b), not lease relaxation.
9. **Audit integrity**: `run_completed.actor: manager` preserved for
   authority; `initiatingActor` recorded in evidence packet for
   audit (S4).
10. **Role expansion blast radius**: deferred to S5.

## Stop conditions (mid-T5 abort triggers)

Halt and re-scope if:
1. T5-S1 wrapper still requires actors to know bearer/header
   internals in normal operation.
2. T5-S2a prompt thinning breaks actor reasoning (actor can't
   recover state from the wakeup delta).
3. T5-D2b proves wait infeasible → narrow S2b or skip entirely.
4. T5-S3b task close-out needs broad policy redesign rather than
   a bounded synthesis path.
5. Any slice requires closed v2-core kernel surface mutation
   (events/schemas/authority).

## Status tracker

| Slice    | Status   | Owner    | Notes                                          |
| -------- | -------- | -------- | ---------------------------------------------- |
| T5-S1    | pending  | sandbox  | Canonical actor API (CLI + HTTP + env handoff) |
| T5-S2a   | pending  | sandbox  | Prompt thinning                                |
| T5-D2b   | pending  | sandbox  | Wait feasibility proof                         |
| T5-S2b   | gated    | sandbox  | Conditional on D2b GO                          |
| T5-S3a   | pending  | sandbox  | Residual P1 cleanup                            |
| T5-S3b   | pending  | sandbox  | Task close-out synthesis                       |
| T5-S4    | pending  | sandbox  | orchestrator mode + run_completed audit        |
| T5-S5    | deferred | sandbox  | Open role schema (separate contract iteration) |

## References

- Behavioral analysis: OC Companion `task-e11a7e-18aa8e` (full
  transcript review, file:line citations).
- @oracle Discovery review: `task-4105e8-a220dc` verdict
  NEEDS_REVISION → resolved by this slice cut.
- T4 fixture (target for T5 baseline + re-capture):
  `tests/fixtures/live-smoke/run-hello-team-agentic-tool-mock/`.
- Predecessor plans:
  `docs/plans/completed/v2-mcp-tool-driven-agentic-loop.md`,
  `docs/plans/completed/v2-agentic-orchestration.md`.

## Last updated

2026-05-08 — initial plan; ready to dispatch T5-S1.
