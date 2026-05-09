# Pluto v2 — Actor Bridge Fix (T6)

> [!NOTE]
> **Per-slice reports** (in execution order):
> - [T6-S1 — actor bootstrap bridge wrapper + prompt path threading](../../../tasks/remote/pluto-v2-t6-s1-actor-bridge-20260509/artifacts/REPORT.md) (subsumed T6-S2)
> - [T6-S3 — bridge self-check + fail-fast on `bridge_unavailable`](../../../tasks/remote/pluto-v2-t6-s3-bootstrap-self-check-20260509/artifacts/REPORT.md)
> - [T6-S4 — lead role anchor in bootstrap prompt](../../../tasks/remote/pluto-v2-t6-s4-lead-role-anchor-20260509/artifacts/REPORT.md)
> - [T6-S5 — strengthened smoke-live acceptance + POST-T5 fixture as regression](../../../tasks/remote/pluto-v2-t6-s5-smoke-acceptance-20260509/artifacts/REPORT.md)
> - [T6-S6 — telemetry truthfulness + runtime diagnostics](../../../tasks/remote/pluto-v2-t6-s6-telemetry-20260509/artifacts/REPORT.md)
>
> **POST-T5 finding (input):** `tests/fixtures/live-smoke/post-t5-poet-critic-haiku/` — captured as a permanent regression by T6-S5.
>
> **Successor plan:** [T7 craft fidelity + telemetry tightening](v2-craft-fidelity-and-telemetry.md) (POST-T6 validation passed at smoke level but flagged 3 sub-issues).

> **Status:** drafted 2026-05-09 from POST-T5 validation finding.
> **Authority:** this file is canonical for T6.
> **Predecessor:** T5 actor-loop hardening (`docs/plans/completed/v2-actor-loop-hardening.md` once T5 is moved there).
> **Trigger:** POST-T5 validation run (`tests/fixtures/live-smoke/post-t5-poet-critic-haiku/`) failed with `maxNoProgressTurns exhausted`. Zero accepted mutations. Custom user workflow non-functional end-to-end.

## Why T6 exists

T5 landed 6 actionable slices on `main`. All slice tests passed. The
captured fixture replayed correctly. But a **real** custom user
workflow on a sandboxed paseo + real LLM (`gpt-5.4-mini`) **fails
totally**: the lead actor cannot invoke any Pluto tool because the
"stable actor API + env handoff" advertised by T5-S1 doesn't actually
land in the spawned actor's process.

Two co-pillared bugs make T5's actor contract **false in production**:

### Bug A: env handoff doesn't reach the actor

`packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts:770-778`
sets `PLUTO_RUN_API_URL` / `PLUTO_RUN_TOKEN` / `PLUTO_RUN_ACTOR` into
`actorSpec.env`. But:

- `packages/pluto-v2-runtime/src/adapters/paseo/paseo-cli-client.ts:314-321`
  applies that env to the **local `paseo run` CLI invocation** —
  the parent of the daemon RPC, not the actor process.
- Paseo's own `client.createAgent` request has **no env field**
  at any layer (CLI command construction, daemon client, wire
  schema). The env object is silently dropped on the floor.

Tests passed because the test mock for `processSpawn` only asserts
the parent process received `env` — it doesn't (and can't) verify
the daemon-side actor process inherited it.

### Bug B: `pluto-tool` isn't actually on the actor's PATH

`packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts:233-255`
tells the actor "you have a CLI tool named `pluto-tool` available
in your shell." But the runtime's `prepareAgentInjection`
(`run-paseo.ts:526-535`) only creates an actor cwd. It does not:
- Install a wrapper script,
- Prepend a path to PATH,
- Materialize `pluto-tool` as an executable in the actor cwd.

So the actor's first bash call hits "configured CLI name isn't on
PATH" and starts hunting for the binary — confirmed in the lead
transcript at line 137.

## End-to-end consequence

Lead spent 15 minutes hunting env vars and the binary, eventually
mistook itself for an external operator and tried to use `paseo send`
to command "another lead session." Zero accepted kernel mutations.
Run aborted on `maxNoProgressTurns`.

## What works (do NOT regress)

- Custom workflow input load (authored-spec + playbook injection)
- Bootstrap-once prompt + wakeup deltas
- Driver-synthesized failure close-out (S3b path generalized)
- Initiating-actor audit on failure path (S4)
- Closed kernel + replay determinism
- Wait registry + dual-mode delivery (untouched, intact)

## Slices

### T6-S1 — Real actor bootstrap bridge

**Goal:** make the post-S1 actor contract actually true. The actor
spawned by paseo MUST be able to invoke `pluto-tool` against the
live run.

**Approach (preferred):** materialize a **bridge wrapper** in the
actor cwd at injection time. The wrapper embeds the URL/token/actor
identity (or reads them from a sibling JSON written at injection)
and invokes the local `pluto-tool` source. Update the prompt to
reference the exact wrapper path (e.g. `./pluto-tool` in the actor's
cwd) — no PATH magic.

**Alternative (rejected):** add real per-agent `env` support to
paseo end-to-end. Out of scope for T6 since it would require
modifying the paseo project.

**Deliverables:**
- New file: `packages/pluto-v2-runtime/src/adapters/paseo/actor-bridge.ts`
  (wrapper materializer)
- `run-paseo.ts` `prepareAgentInjection`: write the wrapper
- `agentic-tool-prompt-builder.ts`: emit the exact wrapper path
- New integration test that spawns a real subprocess in a temp
  cwd and proves `./pluto-tool read-state` works.

**Cost:** ~300-500 LOC, 3-5 files.

### T6-S2 — Fix tool-contract assertions in the bootstrap prompt

**Goal:** stop promising what isn't true. Match the prompt to
whatever T6-S1 lands.

**Deliverables:**
- `agentic-tool-prompt-builder.ts`: replace
  "`pluto-tool` is available in your shell" with
  "the wrapper script `<wrapperPath>` is in your working directory"
  (or whatever T6-S1 produces)
- Update fixture-related test prompts.

**Cost:** ~50-150 LOC, 1-2 files.

### T6-S3 — Bootstrap self-check + fail-fast

**Goal:** if the bridge can't be invoked on turn 1, abort the run
with a clear `bridge_unavailable` failure instead of burning four
empty wakeups.

**Deliverables:**
- `run-paseo.ts`: on first agent spawn, run a synthetic
  `read-state` self-check. If it fails, emit a structured
  `run_completed` with status=failed and a `bridge_unavailable`
  reason, and short-circuit the loop.
- New test for the fail-fast path.

**Cost:** ~150-250 LOC, 2-3 files.

### T6-S4 — Lead role-anchor in the prompt

**Goal:** the lead must understand it IS the live actor — not an
external operator. Don't assume the LLM figures this out from
context.

**Deliverables:**
- `agentic-tool-prompt-builder.ts`: add a clear "you are the
  live `<actor>` actor for run `<runId>`. Do NOT use external
  control planes (paseo, daytona, etc.) to drive this run."
- Tests assert the language is present in the bootstrap.

**Cost:** ~50-100 LOC, 1-2 files.

### T6-S5 — Strengthen live-smoke acceptance criteria

**Goal:** smoke-live must fail unless it observes:
- ≥1 accepted `task_created`
- ≥1 mailbox completion to lead
- terminal `run_completed` with status=succeeded
- non-empty sub-actor transcripts (not just lead)

**Deliverables:**
- `packages/pluto-v2-runtime/scripts/smoke-live.ts`: post-run
  invariants check; non-zero exit on violation
- New CI invariant fixture so future iterations can't regress.

**Cost:** ~150-250 LOC, 1-2 files.

### T6-S6 — Telemetry truthfulness

**Goal:** `usage-summary.json` should not report 0 tokens for a
333-line transcript. Misleading.

**Deliverables:**
- When usage data is unavailable, record `null` / `unknown`,
  NOT `0`.
- Persist bridge diagnostics + wait-state reason codes in the
  evidence packet so failed live smokes are diagnosable from the
  artifacts alone.

**Cost:** ~150-300 LOC, 2-4 files.

## Risk register

1. **Bridge wrapper itself fails in some sandbox** → T6-S3 self-check
   catches it; failure is loud, not silent.
2. **Wrapper materialization conflicts with paseo's cwd lifecycle**
   → T6-S1 must align with `prepareAgentInjection`'s existing cwd
   convention.
3. **Captured fixture would need re-generation** → out of scope; the
   captured fixture is mock-paseo; a future fixture refresh after
   T6 would record the real bridged path.

## Stop conditions

1. T6-S1 wrapper approach requires kernel changes → STOP.
2. Real per-agent env support in paseo would be cleaner → escalate
   to operator; defer T6-S1 until decided.

## What's NOT in T6

- Open role schema (still T5-S5 deferred contract slice).
- Recapturing the live-smoke fixture (its own cleanup slice later).
- Any cross-runtime adapter beyond paseo.
