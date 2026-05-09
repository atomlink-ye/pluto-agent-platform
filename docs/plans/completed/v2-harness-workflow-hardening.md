# Pluto v2 — Harness Workflow Hardening (T9)

> [!NOTE]
> **Per-slice reports** (in execution order):
> - [T9-S1 — unified actor CLI + explicit `--actor` + server-side header-required check](../../../tasks/remote/pluto-v2-t9-s1-unified-cli-20260509/artifacts/REPORT.md) *(merged at `9e42f54`; token-actor cryptographic binding split to T9-S1b)*
> - [T9-S2 — wait as turn lifecycle (auto-suspend after mutation)](../../../tasks/remote/pluto-v2-t9-s2-wait-as-lifecycle-20260509/artifacts/REPORT.md) *(merged at `b48fba0`)*
> - [T9-S3 — TeamProtocol composite tools (worker-complete / evaluator-verdict / final-reconciliation)](../../../tasks/remote/pluto-v2-t9-s3-team-protocol-tools-20260509/artifacts/REPORT.md) *(merged at `62e00a0f`)*
> - [T9-S4 — gate fast-path: typecheck split + TS project references + OOM discipline](../../../tasks/remote/pluto-v2-t9-s4-gate-fast-path-20260509/artifacts/REPORT.md) *(merged at `829b64b7`; partial — diagnostic exit 1→0 via T9-S5 follow-up at `d877c903`; cold typecheck still residual-OOM in some sandbox conditions)*
> - T9-S1b — per-actor bearer-token binding *(merged at `83a649a5`; runtime issues one bearer per actor, route validates `Authorization: Bearer` against the actor bound to that token, fails closed with `403 actor_mismatch` on cross-actor reuse)*
>
> **Predecessors:** [T6 actor bridge fix](../completed/v2-actor-bridge-fix.md) → [T7 craft fidelity + telemetry](../completed/v2-craft-fidelity-and-telemetry.md) → [T8 telemetry runtime aggregates](../completed/v2-telemetry-runtime-aggregates.md).
>
> **Trigger:** POST-T8 confirmed the loop works end-to-end on a custom Symphony workflow (status: succeeded, real lead orchestration, all tasks completed). But actor-facing workflow is still "runtime scripting" — not yet a general protocol-driven Harness. Three structural gaps remain.

> **Status:** drafted 2026-05-09 from POST-T8 PASS verdict + GPT Pro design review.
> **Authority:** this file is canonical for T9.
> **Context packet** (read first when implementing any T9 slice): [`docs/notes/t9-context-packet.md`](../../notes/t9-context-packet.md) — repo map, forbidden zones, gate policy, known noise.

## Why T9 exists

T5-T8 closed the iterate-until-clean loop on the LOOP (bridge works,
craft fidelity holds, telemetry honest). But the actor contract is
still scripty:

1. **Identity is filesystem-baked**, not protocol-explicit. Each
   actor gets its own `<actorCwd>/pluto-tool` wrapper with
   `handoff.json` baking the actor key. Custom roles like
   `poet`/`critic` can't be added without materializing new
   wrappers; same role with multiple sessions doesn't generalize.
2. **`wait` is an opt-in tool, not a lifecycle primitive**. The
   prompt says "prefer wait" but if the LLM forgets, it falls back
   to `read-state` polling — and the captured Symphony run only
   armed wait some of the time (8 traces over a multi-task run is
   fewer than the events-per-actor count). The Harness never
   *forces* wait.
3. **Tools are primitives**, not composite team protocol verbs.
   Lead has to glue `create-task` + interpret-mailbox-by-prose +
   `complete_run` rather than `worker-complete` /
   `evaluator-verdict` / `final-reconciliation` as first-class
   ops. Driver synthesis (T5-S3b) papers over this for one case
   (task close-out from completion mailbox) but doesn't generalize.

Per GPT Pro design review:

> 把优先级压成三句话:
> 1. 统一 actor-facing CLI: 一个 binary, 角色用参数和 server-side binding 区分.
> 2. 把 wait 从可选工具升级成 turn lifecycle: mutation 后自动挂起, event 到达再唤醒.
> 3. 把 primitive tools 升级为 TeamProtocol composite tools.

T9 is exactly these three. Open role schema (T5-S5 deferred) and
final reconciliation audit are kept for later (T10 candidates) so
T9 stays focused.

## What works (do NOT regress)

Everything from T5-T8: real bridge, role anchor, craft fidelity,
wait registry, dual-mode delivery, task close-out synthesis,
runtime diagnostics, null telemetry, smoke-acceptance gate, captured
POST-T8/Symphony fixtures as regressions, all 220+ runtime + 37
root tests.

## Slices

### T9-S1 — Unified actor CLI + explicit identity

**Goal:** one CLI binary per run (not per actor); `--actor` is a
required parameter; server fail-closed binds token to allowed actor.

**Approach:**

- Materialize the bridge as ONE run-level binary at
  `<runDir>/bin/pluto-tool` (or similar). All actors invoke the
  same path.
- Keep per-actor `<actorCwd>/pluto-tool` as a thin compatibility
  wrapper that forwards to the run-level binary with default
  `--actor` filled in (so existing prompts still work during
  transition). Eventually the bootstrap prompt should cite the
  run-level path directly.
- Make `--actor <actorKey>` a required flag on every mutating
  command, surfaced in the prompt.
- Server-side: the bearer token, when introduced at run start, is
  bound to a specific actor. Requests carrying `--actor` that
  doesn't match the token's bound actor get HTTP 403 +
  `actor_mismatch` error code.
- Per-actor `handoff.json` becomes the channel for token + actor
  binding (CLI reads token from there, server validates token
  against bound actor).

**Deliverables:**
- `pluto-tool.ts`: add `--actor <key>` flag; require for mutating;
  read token from `handoff.json` (already does — verify).
- `pluto-local-api.ts`: tighten the existing actor header check —
  fail closed on token/actor mismatch with structured error.
- `actor-bridge.ts`: materialize the run-level binary; emit per-actor
  thin wrappers OR drop them in favor of just the run-level binary.
- `agentic-tool-prompt-builder.ts`: emit the run-level binary path;
  tell each actor "invoke via `<binary> --actor role:X <subcommand>`".
- Tests: actor-mismatch returns 403; same binary path used by
  multiple roles in one run; backward-compat wrapper still works.

**Cost:** ~400-700 LOC, 4-6 files.

**Stop condition:** if eliminating per-actor wrappers breaks the
existing role-anchor (T6-S4) prompt threading in a way that requires
restructuring more than 2 slice predecessor files, STOP and reduce
scope to "expose `--actor` flag and server-side binding only".

### T9-S2 — Wait as turn lifecycle

**Goal:** the Harness drives actor suspension. After a non-terminal
mutating call, the actor's session goes to `waiting` automatically —
NOT because the LLM remembered to invoke `wait`. Driver wakes the
actor when an event matching its visibility filter lands.

**Approach:**

- Server-side response shape: every mutation response includes
  `turnDisposition: "waiting" | "idle" | "terminal"` and (when
  waiting) `nextWakeup: "event"`.
- `pluto-tool` mutating commands: after a successful mutation,
  default behavior is to wait (i.e., the CLI itself blocks until
  the registry delivers an event). Add `--no-wait` to opt out
  (rare).
- `run-paseo.ts`: track `ActorTurnState = active | waiting | idle | terminal` per actor. Drive transitions:
  - mutation accepted → `waiting` (unless complete_run terminal)
  - event delivered to wait → `active`
  - actor session ends without complete_run → `idle`
  - run completes → all `terminal`
- Polling-detection: smoke-acceptance asserts there are NO
  consecutive `read-state` calls between mutations from the same
  actor. Existing test infra should already capture this.

**Deliverables:**
- `pluto-local-api.ts`: emit `turnDisposition` in mutation responses.
- `pluto-tool.ts`: auto-wait on mutating commands.
- `run-paseo.ts`: turn-state machine + state-aware scheduling.
- `wait-registry.ts`: minor — likely already exposes the right
  primitives, just consumed differently.
- Tests: lead creates task → CLI auto-blocks until event; manager
  wakeup delivers; same flow without explicit `wait` calls; assert
  no `read-state` polling between mutations.

**Cost:** ~500-900 LOC, 4-6 files.

**Stop condition:** if auto-wait conflicts with paseo's session
keep-alive timing in a way that produces spurious `client_idle_disconnect`
storms, fall back to "server emits `turnDisposition: waiting` but
CLI does NOT auto-block" — log the choice in the REPORT for T10.

### T9-S3 — TeamProtocol composite tools

**Goal:** replace the LLM's prose-glue with structured composite
verbs: `worker-complete`, `evaluator-verdict`, optional
`revision-request`, and a stub for `final-reconciliation`. Composite
tools translate server-side into the same primitive events
(task_state_changed + mailbox_message_appended + projection inputs)
without expanding the closed kernel `RunEvent` set.

**Approach:**

- `pluto-tool worker-complete --task-id <id> --summary <text> [--artifact <id>]`:
  server translates to `task_state_changed → completed` (authored by
  the worker) + `mailbox_message_appended kind=completion` to the
  delegating actor (lead).
- `pluto-tool evaluator-verdict --task-id <id> --verdict pass|needs-revision|fail --summary <text>`:
  translates to `mailbox_message_appended kind=completion|final|rejected` + (optionally)
  `task_state_changed` if pass closes the bound task.
- `pluto-tool final-reconciliation --completed-tasks <ids> --cited-messages <ids> --summary <text>`:
  initial version is a thin wrapper around `complete_run` with
  structured args; T10 will harden this into an audit gate.
- Driver-synthesized close-out from T5-S3b becomes redundant when
  worker-complete is used (clean path), but kept as a fallback for
  back-compat with raw mailbox usage.
- Prompt updates: each actor's bootstrap prompt cites the relevant
  composite verb for its role. Lead uses `final-reconciliation`,
  generator uses `worker-complete`, evaluator uses `evaluator-verdict`.

**Deliverables:**
- `pluto-tool.ts`: 3 new composite subcommands.
- `pluto-tool-handlers.ts`: 3 new handler functions translating
  composite ops into primitive ProtocolRequests.
- `pluto-local-api.ts`: 3 new HTTP routes.
- `agentic-tool-prompt-builder.ts`: prompt-side language updates.
- Tests: each composite command produces the expected primitive
  event sequence.

**Cost:** ~700-1100 LOC, 6-9 files.

**Stop condition:** if any composite verb requires authority-matrix
changes in v2-core, STOP — kernel byte-immutable rule wins.

### T9-S4 — Gate fast-path: typecheck split + TS project references

**Inserted between S3 and S1b after S1/S2/S3 each spent significant
time on sandbox cgroup OOM-killer events during
`pnpm --filter @pluto/v2-runtime typecheck`. Tooling slice; no
behavioral change.**

**Goal:** make the runtime typecheck fast and reliable on the
sandbox so subsequent slices stop fumbling on retries.

**Approach:**

- Split runtime typecheck into `tsconfig.src.json` (src only) and
  `tsconfig.test.json` (tests only, references the src project).
  `typecheck:src` becomes the fast-path gate.
- Make `@pluto/v2-core` a composite TS project; runtime references
  it via project references with `incremental: true`. Avoids
  recompiling core source on every runtime typecheck.
- Codify single-attempt OOM fallback in `commands.sh`: on exit
  137 ("Killed" / cgroup OOM-killer), record once, do NOT retry
  with `NODE_OPTIONS=--max-old-space-size` (raises Node heap
  ceiling closer to cgroup limit, making OOM happen sooner). Do
  NOT invoke `./node_modules/.bin/tsc` (it's a bash wrapper).

**Deliverables:**
- `tsconfig.src.json` + `tsconfig.test.json` for v2-runtime.
- `composite: true` on v2-core's tsconfig.
- `package.json` typecheck scripts (`typecheck:src`, `typecheck:test`,
  composed `typecheck`).
- `.gitignore` covers `*.tsbuildinfo`.
- Updated `commands.sh` template with the new gate template + OOM-discipline comment.
- Updated `docs/notes/t9-context-packet.md` reflecting new commands.

**Cost:** ~150-250 LOC (mostly tsconfig + package.json + commands.sh).
ZERO source `.ts` changes.

**Stop condition:** if `composite: true` cascades to require source
import changes in > 5 files, fall back to "src/test typecheck split
only; defer project references to T10."

### T9-S1b — Per-actor bearer-token binding

**Deferred from T9-S1.** Implements the cryptographic token-actor
binding that S1 narrowed away (run-paseo.ts:633 currently issues
ONE bearerToken per run; S1b makes it per actor).

**Goal:** server fail-closed when the bearer token does not match
the actor named in `Pluto-Run-Actor` header.

**Approach:**
- Per-actor token issuance in `run-paseo.ts`.
- Token registry keyed by actor.
- Mutating route validates `Authorization: Bearer <token>` is
  bound to the actor named in `Pluto-Run-Actor`. Mismatch → 403
  `actor_mismatch`.

**Cost:** ~200-400 LOC.

**Stop condition:** if the per-actor token issuance breaks the
existing handoff.json contract in a way that cascades to > 3
predecessor source files, narrow scope.

## Risk register

1. T9-S1: changing the wrapper convention may break existing
   POST-T8 fixture's prompt (which cites `<actorCwd>/pluto-tool`).
   Mitigation: keep per-actor wrappers as thin redirects during
   T9; recapture fixture after T9 lands.
2. T9-S2: auto-wait could trigger paseo client timeouts on long
   waits. Mitigation: T7-S3 already classified `client_idle_disconnect`
   as benign; document that auto-wait will fire it more often, and
   ensure the run still recovers as before.
3. T9-S3: composite verbs may overlap with future open-role schema
   (T5-S5 / GPT Pro H5). Mitigation: keep verbs role-agnostic
   (worker-complete is who sent it, not "generator-complete"); the
   actor's role only feeds the projection layer.

## Stop conditions (mid-T9 abort triggers)

1. Any slice requires v2-core kernel mutation → STOP.
2. T9-S1 wrapper change cascades to > 5 predecessor source files →
   STOP, reduce scope.
3. T9-S2 auto-wait makes more than 2 existing tests fail in
   semantically-incompatible ways → STOP, fall back to
   server-disposition-only.

## What's NOT in T9

- Final-reconciliation audit gate with citation validation (H4 —
  T10 candidate; T9-S3 ships a stub).
- Open role schema (H5 / T5-S5 — separate iteration).
- UI / catalog / schedule / governance (operator explicitly said
  "继续只打 Harness").
