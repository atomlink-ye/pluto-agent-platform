# T9-S2 — Wait as turn lifecycle

You are an OpenCode Companion implementing **T9-S2**, the second
slice of the Harness Workflow Hardening iteration.

**Authority plan:** `docs/plans/active/v2-harness-workflow-hardening.md` T9-S2.
**Predecessor merged:** T9-S1 narrowed at `9e42f54` on `main`.

## Why T9-S2 exists

T9-S1 fixed identity (`--actor` is now an explicit CLI parameter
and the bridge materializes a run-level binary). But the actor's
lifecycle is still scripty: the bootstrap prompt says "after a
mutation, prefer to call `wait` rather than `read-state`," and
when the LLM forgets, it falls back to polling. The Harness never
*forces* suspension between turns. POST-T8 traces showed `wait`
fired ~8 times in a multi-task Symphony run — fewer than the
events-per-actor count.

GPT Pro design review:

> 把 wait 从可选工具升级成 turn lifecycle: mutation 后自动挂起,
> event 到达再唤醒.

## Goal

After T9-S2:

1. **Every successful mutating CLI response carries `turnDisposition`**
   (`"waiting" | "idle" | "terminal"`). The current default is
   `"waiting"` for mutations that don't terminate the run.
2. **CLI `pluto-tool` mutating commands auto-block on `wait` after
   the mutation succeeds**, unless `--no-wait` is passed. The
   subcommand returns ONE merged JSON response shape:
   `{ mutation: <pre-wait response>, wait: <event payload> }`.
3. **Driver `run-paseo` tracks `ActorTurnState` per actor**:
   `active | waiting | idle | terminal`. The state advances on
   every mutation/event/run-completion — no busy waiting, no
   `read-state` polling between events.
4. **Smoke acceptance asserts no polling**: between any two
   mutations from the same actor in a run, there must NOT be a
   `read-state` invocation.

## Scope (in)

### 1. CLI auto-wait on mutating commands

**Modify** `packages/pluto-v2-runtime/src/cli/pluto-tool.ts`:

- Each mutating subcommand (`create-task`, `change-task-state`,
  `append-mailbox-message` / `send-mailbox`, `publish-artifact`)
  after a successful mutation:
  - Inspects the response's `turnDisposition` field.
  - If `"waiting"`, immediately invokes the existing `wait`
    primitive logic (same as `pluto-tool wait`) using the
    actor's session and a sane default timeout (e.g.,
    inherited from a CLI flag `--wait-timeout-ms` or env
    `PLUTO_WAIT_TIMEOUT_MS`, default `120000`).
  - If `"idle"` or `"terminal"`: do NOT auto-wait; just return
    the mutation response.
  - Returns merged JSON: `{ mutation: <m>, wait: <w> }`. If
    the wait times out, returns `{ mutation: <m>, wait: { kind:
    "wait_timeout", timeoutMs: <n> } }` — non-fatal so the
    actor can decide.
- `--no-wait` flag opts out (rare; for tooling/tests).
- `complete-run`: returns `turnDisposition: "terminal"`. CLI
  does not auto-wait — exit normally.
- The standalone `pluto-tool wait` subcommand is unchanged
  (still callable for explicit waits).

### 2. Server emits `turnDisposition`

**Modify** `packages/pluto-v2-runtime/src/api/pluto-local-api.ts`:

- Each mutating route's success response gains a
  `turnDisposition` field:
  - `complete-run` → `"terminal"`.
  - All other mutations → `"waiting"`.
  - Reserve `"idle"` for the future case where a mutation
    intentionally doesn't suspend (none today, but the value
    must be defined in the type).
- Add `nextWakeup: "event" | "none"` companion field for
  observability (only set when waiting).
- The route's request handler does NOT block on the wait;
  the CLI is responsible for issuing the wait call. Server
  just signals the disposition.

### 3. Turn-state machine in the driver

**Modify** `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`:

- Define and track per-actor `ActorTurnState`:
  `"active" | "waiting" | "idle" | "terminal"`.
- Initial state on actor session start: `"active"`.
- After mutation accepted (server emits event): actor → `"waiting"` (unless terminal).
- Wake-up event delivered to actor's wait (registry releases): `"waiting"` → `"active"`.
- Actor session ends without `complete-run`: `"idle"` (and the driver should not refire that actor).
- Run reaches `complete-run`: ALL actors → `"terminal"`.
- Use this state to decide scheduling — never re-prompt an actor
  in `"waiting"` until an event lands.
- Diagnostic: emit a `turn_state_transition` trace for each
  transition (driver-only trace, not RunEvent).

### 4. Wait registry consumed differently

**Inspect/lightly modify** `packages/pluto-v2-runtime/src/api/wait-registry.ts`:

- The registry is consumed by the CLI's auto-wait path. If a
  helper API surface needs to be added (e.g., `armWaitForActor`),
  do so without breaking existing callers.
- Do NOT expand the closed kernel `RunEvent` set.

### 5. Smoke acceptance — no-polling assertion

**Modify** `packages/pluto-v2-runtime/scripts/smoke-acceptance.ts`:

- Add a check: for each actor, scan the run's traces; assert
  there is NEVER a `read-state` call sandwiched between two
  same-actor mutations.
- New failure category: `polling_detected: actor=<key> after_mutation=<eventId> read_state_calls=<n>`.
- The check should pass for any run where every mutation is
  followed by a wait → next mutation chain.

### 6. Tests

**New / modified:**

`packages/pluto-v2-runtime/__tests__/cli/pluto-tool.test.ts` (extend):
- A mutating CLI call returning `turnDisposition: "waiting"` AUTO-WAITS
  by default; the response shape is `{ mutation, wait }`.
- A mutating CLI call with `--no-wait` returns ONLY the mutation
  response (no `wait` key).
- A `complete-run` call returns the mutation response with
  `turnDisposition: "terminal"` and does NOT auto-wait.

`packages/pluto-v2-runtime/__tests__/api/pluto-local-api.test.ts` (extend):
- Mutating route response includes `turnDisposition: "waiting"`
  and `nextWakeup: "event"`.
- `complete-run` route response includes `turnDisposition: "terminal"`.

`packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts` (extend):
- A run where lead creates a task: lead's auto-wait suspends until
  the delegated actor's completion fires; lead's next turn arrives
  WITHOUT any explicit `read-state` call between mutations.

`packages/pluto-v2-runtime/__tests__/adapters/paseo/turn-state.test.ts` (new):
- Driver state transitions: active → waiting on mutation;
  waiting → active on event delivery; complete-run → terminal.
- A `turn_state_transition` trace fires on each transition.

## Scope (out — DO NOT touch)

- `packages/pluto-v2-core/**` (closed kernel — byte-immutable).
- `packages/pluto-v2-runtime/src/tools/**` (kernel-adjacent
  intent surface — N2-grep gate applies).
- `packages/pluto-v2-runtime/src/mcp/**`.
- `packages/pluto-v2-runtime/src/evidence/**` (T6-T8 surface).
- `packages/pluto-v2-runtime/src/adapters/paseo/wakeup-delta.ts`,
  `task-closeout.ts`, `bridge-self-check.ts`,
  `actor-bridge.ts` (T9-S1 surface — only consume).
- `tests/fixtures/live-smoke/**` (read-only fixtures).

## Diff hygiene allowlist

`git diff --name-only main..HEAD` must be a subset of:

- `packages/pluto-v2-runtime/src/cli/pluto-tool.ts`
- `packages/pluto-v2-runtime/src/api/pluto-local-api.ts`
- `packages/pluto-v2-runtime/src/api/wait-registry.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
- `packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts` (only if prompt language needs updating to mention auto-wait — minimal)
- `packages/pluto-v2-runtime/scripts/smoke-acceptance.ts`
- `packages/pluto-v2-runtime/__tests__/cli/pluto-tool.test.ts`
- `packages/pluto-v2-runtime/__tests__/api/pluto-local-api.test.ts`
- `packages/pluto-v2-runtime/__tests__/api/pluto-local-api.actor.test.ts` (only if turnDisposition assertion needs adding)
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-loop.test.ts`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/turn-state.test.ts`
- `tasks/remote/pluto-v2-t9-s2-wait-as-lifecycle-20260509/**` (new)

## Gates

```bash
pnpm install
pnpm --filter @pluto/v2-runtime typecheck       # baseline 0 errors
pnpm exec tsc -p tsconfig.json --noEmit         # baseline 0 errors
pnpm --filter @pluto/v2-runtime test            # baseline 226/228 (2 skipped); must stay or improve
pnpm test                                        # baseline 37/37
```

If the local sandbox baseline shows pre-existing typecheck failures
unrelated to this slice, run baseline against `main` first to
prove they are NOT new.

## Hard rules

- N2 grep gate: forbid `must match exactly` / `payload must match exactly`.
- closed v2-core surface byte-immutable.
- Do NOT expand the closed kernel `RunEvent` set; `turnDisposition`
  lives in the HTTP response shape, NOT in events.
- Auto-wait is OPT-OUT (`--no-wait`), not opt-in. The default for
  every non-terminal mutation must trigger a wait.
- The CLI's auto-wait must NOT re-fire on `complete-run`.
- Don't break `actor-bridge.test.ts` subprocess test (T6-S1 regression).

## Stop conditions

1. The change requires kernel mutation → STOP.
2. Existing tests cascade > 8 files → STOP, narrow scope.
3. Auto-wait creates spurious `client_idle_disconnect` storms
   that break the agentic-tool-loop tests → STOP. Fall back to
   "server emits `turnDisposition` only; CLI does NOT auto-block;
   document the choice and propose T10 follow-up." Push the
   server-disposition-only variant and surface the limitation in
   REPORT.md.

## Deliverables

1. Auto-wait on mutating CLI commands (default on; `--no-wait` opt-out).
2. Server emits `turnDisposition` + `nextWakeup` in mutation responses.
3. Driver tracks per-actor turn state with transitions traced.
4. Smoke acceptance polling-detection check.
5. Tests covering all of above.
6. `tasks/remote/pluto-v2-t9-s2-wait-as-lifecycle-20260509/artifacts/REPORT.md`
   summarizing design choices, esp. timeout defaults, behavior on
   wait-timeout, and any stop-condition fallbacks.

Commit on branch `pluto/v2/t9-s2-wait-as-lifecycle`. Push to origin.
Sandbox push will likely fail on auth — that is expected and
operator handles patch transfer locally.

## Verdict

```
T9-S2 COMPLETE
auto-wait-default: <on|off-with-fallback>
turn-state-machine: <yes|no>
polling-detection: <yes|no>
new tests: <N>
typecheck-new-errors: 0
runtime-tests: <pass>/<total>
root-tests: <pass>/<total>
push: ok | failed
stop-condition-hit: <none|3>
```

Begin.
