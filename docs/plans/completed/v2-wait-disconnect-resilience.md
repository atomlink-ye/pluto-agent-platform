# Pluto v2 — T10 Wait Disconnect Resilience

> [!NOTE]
> **Per-slice reports** (in execution order):
> - T10-S1 — driver-level wait re-arm on `client_idle_disconnect` *(in flight)*
> - T10-S2 — smoke-live polling-detection at run end *(pending)*
>
> **Predecessors:** T9 — Harness Workflow Hardening (S1, S2, S3, S1b, S4, S5 all merged).
>
> **Trigger:** POST-T9 validation on Symphony custom workflow returned **PARTIAL 5/6**. The 1 failure is criterion 3 (no read-state polling between same-actor mutations): the auto-wait DOES arm and DOES suspend, but on paseo's `client_idle_disconnect` keep-alive the wait cancels and the lead's agentic loop falls back to `read-state` polling instead of re-arming `wait`.

> **Status:** drafted 2026-05-09 from POST-T9 PARTIAL evidence.
> **Authority:** this file is canonical for T10.

## Why T10 exists

T9-S2 shipped auto-wait with a documented stop-condition #3:
"if auto-wait conflicts with paseo's session keep-alive timing
in a way that produces spurious `client_idle_disconnect` storms,
fall back to 'server emits `turnDisposition` only; CLI does NOT
auto-block' — log the choice in the REPORT for T10."

POST-T9 confirms this is exactly what happens in practice. The
lead transcript on a real Symphony run shows:

```
turn 5: pluto-tool create-task ... → waiting (wait_armed)
        ... wait_cancelled (client_idle_disconnect) ...
turn 6: pluto-tool read-state    ← fallback polling
turn 7: pluto-tool read-state    ← keeps polling
turn 8: pluto-tool read-state
...
```

The polling-detection in T9-S2's smoke-acceptance.ts WOULD catch
this if applied — it checks for read-state between same-actor
mutations. But the check runs only in unit tests; the live
smoke-live run doesn't apply it.

## What works (do NOT regress)

Everything from T9 (all six slices merged):
- T9-S1 unified actor CLI + run-level binary + header binding
- T9-S2 auto-wait + turn-state machine + polling-detection (unit test)
- T9-S3 composite verbs (worker-complete / evaluator-verdict / final-reconciliation)
- T9-S1b per-actor bearer-token binding
- T9-S4 typecheck split + OOM discipline
- T9-S5 typecheck OOM root-cause partial fix (35% Types reduction)

POST-T9 confirmed: status succeeded, --actor on every mutation,
composite verbs used, no actor_mismatch, final summary verbatim.
Only criterion 3 fails.

## Slices

### T10-S1 — Driver-level wait re-arm on `client_idle_disconnect`

**Goal:** when a wait cancels with `client_idle_disconnect`, the
driver silently re-arms the wait WITHOUT re-prompting the actor.
The actor never sees the disconnect; it just sees the eventual
event. This eliminates the read-state polling fallback.

**Approach:**

- In `run-paseo.ts`'s wakeup path, classify the wait outcome:
  - `unblocked` (event delivered) → wake actor with payload
    (existing behavior).
  - `client_idle_disconnect` (paseo keep-alive) AND actor's
    turn state is still `waiting` → silently re-arm wait
    using the same wait-cursor; do NOT advance the actor's
    turn.
  - Other `wait_cancelled` reasons → existing handling.
- The classification already exists per T7-S3
  (`client_idle_disconnect` was tagged benign there). The fix
  is to act on that classification: instead of reporting the
  disconnect to the actor and letting it choose, the driver
  retries the wait silently.
- Cap re-arm attempts (e.g., 5 consecutive disconnects) to
  prevent infinite loop if the disconnect is genuinely
  pathological. After cap, treat as fatal and emit a
  diagnostic `wait_rearm_exhausted` trace.

**Deliverables:**
- `run-paseo.ts`: silent re-arm path on `client_idle_disconnect`.
- New diagnostic trace `wait_silent_rearm` (driver-only).
- New diagnostic trace `wait_rearm_exhausted` for cap hit.
- Tests: `agentic-tool-loop.test.ts` exercises the disconnect-
  then-event sequence and asserts the actor's transcript shows
  NO `read-state` polling between mutation and event arrival.
- Tests: cap-exhaustion test (5 disconnects in a row, no events).

**Files in scope (allowlist):**
- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
- `packages/pluto-v2-runtime/src/api/wait-registry.ts` (only if needed for new helper API)
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/turn-state.test.ts`
- `tasks/remote/pluto-v2-t10-s1-wait-disconnect-rearm-20260509/**`

**Cost:** ~300-500 LOC.

**Stop condition:** if silent re-arm conflicts with the
existing wait-registry semantics in a way that requires
restructuring more than 2 predecessor source files (T9-S2/S1b
surface), STOP and fall back to "prompt the actor with
'do NOT call read-state; re-issue wait' on disconnect"
(option B, less structural but mechanical).

### T10-S2 — smoke-live polling-detection at run end

**Goal:** the polling-detection check from T9-S2 must run as
part of `smoke-live`'s post-run analysis, not just in unit
tests. So a real run with polling fails the gate.

**Approach:**

- In `smoke-live.ts`'s post-run report, invoke the same
  polling-detection logic from `smoke-acceptance.ts` (extract
  to a shared helper if not already).
- Failure category `polling_detected` becomes a non-zero exit
  for `smoke:live`.
- Backward-compat: legacy fixtures with known polling stay
  green via a fixture-allowlist override (or fixture pin).

**Deliverables:**
- `scripts/smoke-live.ts`: post-run polling-detection check.
- `scripts/smoke-acceptance.ts`: extract helper if needed.
- Tests: existing fixtures still pass.

**Files in scope:**
- `packages/pluto-v2-runtime/scripts/smoke-live.ts`
- `packages/pluto-v2-runtime/scripts/smoke-acceptance.ts`
- (no new tests; existing fixture coverage is enough)
- `tasks/remote/pluto-v2-t10-s2-smoke-live-polling-gate-20260509/**`

**Cost:** ~150 LOC.

**Stop condition:** if extraction breaks T9-S2's existing
polling-detection unit tests, narrow scope to "smoke-live
calls smoke-acceptance helper as-is" without refactoring.

## Risk register

1. T10-S1: silent re-arm could mask genuine actor-stuck cases
   (lead never sees that wait disconnected, can't recover from
   pathological backend). Mitigation: re-arm cap + diagnostic
   trace.
2. T10-S2: making polling fatal in smoke-live could break
   legacy fixtures. Mitigation: fixture allowlist.

## Stop conditions (mid-T10 abort triggers)

1. Any slice requires v2-core kernel mutation → STOP.
2. T10-S1 cascades to > 2 predecessor files → STOP, narrow.
3. POST-T10 still PARTIAL on criterion 3 → root-cause analysis
   in REPORT, may require T11.

## What's NOT in T10

- Final-reconciliation audit gate (H4) — T11 candidate.
- Open role schema (T5-S5 / H5) — separate iteration.
- Further OOM hardening on cold typecheck — T9-S5 left
  documented; future work.
