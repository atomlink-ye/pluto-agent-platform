# Pluto v2 — MCP tool-driven agentic loop (T4)

> **Status:** draft, 2026-05-08. Awaiting operator approval before T4-D0 dispatch.
> **Authority:** this file is the canonical plan for T4. Conflicts with
> bundle docs / future acceptance files → plan wins.
> **Inputs:**
> - Local OpenCode Companion discovery (root `ses_1f9340d65ffeCch8uiHWJRNMfJ`,
>   `@oracle` + `@council` both READY_TO_PLAN).
> - External GPT Pro architectural review at
>   `.learnings/gpt-pro-mcp-architecture-review-2026-05-08.md`.
> - Predecessor plan `docs/plans/active/v2-agentic-orchestration.md`
>   (T1 + T2 merged; T3 partial — see closure note below).

## Why T4 exists

T3 surfaced a structural blocker: text/fenced-JSON parsing as the
control plane between LLM and kernel. Three iterative patches each
exposed a new failure mode (B1 enum-omission, B2 multi-fence
parse-repair, B3 nested-ActorRef shape, then JSON-Schema fence
collision). Pattern: every fix opens the next.

Pluto's TRD has always said **model text ≠ state**. Only structured
protocol/tool calls — validated by parse + schema + sender +
authority + current-state checks — may produce events. Text parsing
was a temporary scaffold, never the design.

T4 brings the implementation back in line with the design by making
every actor mutation a typed MCP tool call against an in-process
Pluto MCP server.

## Hard architecture decisions

(Convergent picks from discovery + GPT Pro. Divergences resolved
explicitly inline.)

1. **One in-process Pluto MCP server per `pluto:run`.** Embedded
   inside the `runPaseo()` driver process; exposed as
   `http://127.0.0.1:<random>/mcp`. Lifetime = run lifetime.

   - **Resolves Discovery vs GPT Pro:** Discovery said "per-run
     daemon owns RunKernel"; GPT Pro Option A said "driver owns
     RunKernel + thin ToolBridge IPC". Both unify if the MCP
     server is **in-process** with `runPaseo`: the HTTP/MCP
     boundary IS the IPC, and the kernel stays owned by the
     driver process. No separate process, no second source of
     truth.

2. **Kernel ownership unchanged.** `RunKernel` lives where it
   lives today. The MCP server holds a reference to the live
   kernel and calls `submit(...)` directly. No new kernel API,
   no replay surface change.

3. **Tool surface = 5 mutating + 3 read-only.**

   Mutating (1:1 with closed protocol intents):
   - `pluto_create_task(title, ownerActor, dependsOn?)`
   - `pluto_change_task_state(taskId, to)`
   - `pluto_append_mailbox_message(toActor, kind, body)`
   - `pluto_publish_artifact(kind, mediaType, byteSize, body?)`
   - `pluto_complete_run(status, summary)` — lead-only;
     daemon converts to manager-synthesized request internally
     (matches today's `runPaseo:173-191` behavior).

   Read-only:
   - `pluto_read_state()` — returns PromptView shape.
   - `pluto_read_artifact(artifactId)` — resolves sidecar path.
   - `pluto_read_transcript(actorKey)` — returns captured
     transcript text.

   Envelope fields (`runId`, `requestId`, `actor`,
   `clientTimestamp`, `schemaVersion`, mailbox `fromActor`) are
   bound by the daemon from session context — never exposed to
   the model.

4. **One mutating call ends the turn.** Reads are unlimited;
   the first write commits the turn outcome. Idle-without-write
   counts against `maxNoProgressTurns`, not parse failure (parse
   failure as a concept disappears from this lane).

5. **Authority = two layers.**
   - Daemon turn-lease check (rejects out-of-turn writes).
   - Existing core authority matrix (rejects role/intent
     mismatches). Both must pass.

6. **Replay determinism preserved.** Tools never mint persistent
   ids; tool results are derived from accepted/rejected kernel
   events. Sidecar artifact bodies and transcript files are audit
   aids, not replay truth.

7. **Mode naming.**
   - `agentic_tool` — new, MCP-driven, becomes the agentic
     primary by end of T4.
   - `agentic_text` — current text/fenced-JSON lane, renamed
     and marked experimental/deprecated. Kept for one slice as
     a safety fallback; deleted in T4-S4.
   - `deterministic` — unchanged (S4 parity fixture).

8. **paseo MCP injection.** No `paseo --mcp` or
   `opencode run --mcp` flag exists. **T4-D0 empirical
   finding (2026-05-08, `main @ 0d22433`):** the spawned
   OpenCode actor only reaches `tools/call` when MCP config
   is delivered via a temp project-local **`opencode.json`
   written into the per-actor `cwd`** before
   `paseoCli.spawnAgent`. The `OPENCODE_CONFIG_CONTENT` env
   route reaches MCP discovery (`initialize` →
   `notifications/initialized` → `tools/list`) but the agent
   does not invoke `tools/call` under that path. **Adopt
   temp-file injection as primary**; keep
   `OPENCODE_CONFIG_CONTENT` as a best-effort/diagnostic
   fallback. See `docs/notes/t4-d0-mcp-injection.md`.

9. **Closed schemas unchanged.** v2-core protocol envelopes,
   event kinds, payloads, authority matrix all byte-stable.
   Tool schemas are derived from existing payload schemas — no
   duplication.

10. **No `pluto_search_repo`.** OpenCode already has native repo
    tools; Pluto MCP stays protocol/run-specific.

## T3 closure (companion to T4)

Per discovery + GPT Pro, T3's text-parsing live smoke is abandoned.
What gets shipped from T3's partial work:

**Keep (independent value, ship as T3-CLOSE):**
- Full run directory under `tests/fixtures/live-smoke/<runId>/`.
- `authored-spec.yaml` + `playbook.md` + `playbook.sha256` capture.
- Transcript collection.
- Honest `usageStatus` flag.
- Doc updates for run-dir and audit artifacts.

**Drop:**
- Text-parse acceptance language ("multi-fence rejection",
  "extractDirective scoped to latest turn").
- Parse-repair live-smoke framing.
- `agentic-live-invariants.test.ts` invariants that depend on a
  successful text-parse run.

**Plan move:** mark T3 as `superseded-by: T4` in
`v2-agentic-orchestration.md` status row in the same commit that
lands this plan. No separate T3-CLOSE merge: the "keep" deliverables
(full run-dir, transcripts, `usageStatus`) all merged with T1/T2;
the T3 doc updates land cleaner alongside `agentic_tool` docs in
T4-S4. Do not move `v2-agentic-orchestration.md` to `completed/`
until T4-S4 lands.

## Slice decomposition

5 slices. Each is independently dispatchable to a fresh OpenCode
Companion (remote-first per memory rule
`feedback_remote_first_for_parallelism.md`).

### T4-D0 — paseo MCP injection proof (read-only)

**Goal:** prove a Paseo-spawned OpenCode actor can reach a
localhost Pluto MCP server during a `pluto:run`.

**Scope:**
- Add minimal HTTP server in `runPaseo` that exposes one MCP tool
  `pluto_read_state` (returns PromptView).
- Inject `OPENCODE_CONFIG_CONTENT` into spawned agent env.
- Mock spec scenario where lead is told "call `pluto_read_state`
  and emit a mailbox via the existing text directive lane".
- If `OPENCODE_CONFIG_CONTENT` doesn't reach the spawned session,
  fall back to writing temp `opencode.json` in actor `cwd`. Document
  whichever works.

**Acceptance:**
- One spawned actor successfully calls `pluto_read_state` once.
- Captured in a discovery write-up; no production lane swap.
- Documents the chosen injection path.

**Stop condition:** if neither env nor temp-file route reliably
reaches the spawned agent, halt T4 and re-scope. Possibilities
include extending Pluto's spawn client env plumbing or proposing a
Paseo CLI extension externally.

### T4-S1 — tool surface contract (in-process, no transport)

**Goal:** define and unit-test all 8 tool schemas + handlers
without any MCP server / HTTP / process boundary.

**New files:**
- `packages/pluto-v2-runtime/src/tools/pluto-tool-schemas.ts` —
  zod schemas for the 8 tools, derived from v2-core payload
  schemas (no duplication).
- `packages/pluto-v2-runtime/src/tools/pluto-tool-handlers.ts` —
  pure handlers that take `(kernel, sessionContext, args)` and
  return an MCP-shaped tool result (structured event echo).

**Tests:**
- Each tool: arg parse, ProtocolRequest construction, kernel
  submit, accepted-event echo, authority rejection, lease
  rejection.
- `pluto_complete_run` lead-only test (sub-actor caller rejected;
  manager synthesis preserved).
- `pluto_publish_artifact` sidecar path determinism test.

**Out of scope:** MCP transport, HTTP, OpenCode wiring.

**Acceptance:**
- Typecheck + tests green.
- Handlers callable from any Node test harness.
- No new event kinds.

### T4-S2 — MCP server + lease + transport

**Goal:** wrap the T4-S1 handlers in a real MCP server bound to
`127.0.0.1` with bearer-token auth and a turn lease.

**New files:**
- `packages/pluto-v2-runtime/src/mcp/pluto-mcp-server.ts` —
  HTTP/MCP server, random localhost port, bearer token, bound
  127.0.0.1, auto-shutdown on run completion.
- `packages/pluto-v2-runtime/src/mcp/turn-lease.ts` — current
  actor lease (matches `agentic-loop-state.currentActor`).

**Tests:**
- Integration via in-process MCP client: 5 writes + 3 reads work.
- Out-of-lease writes rejected.
- Bad token rejected.
- Server starts/stops cleanly inside a runPaseo lifecycle test.

**Out of scope:** real Paseo agent integration; that's T4-S3.

**Acceptance:**
- Typecheck + tests green.
- Server lifecycle is deterministic and leak-free.

### T4-S3 — driver loop swap (mode `agentic_tool`)

**Goal:** make `runPaseo` route agentic runs through the MCP
server and tool calls instead of `extractDirective`.

**Changes:**
- New `orchestration.mode: 'agentic_tool'`.
- Rename existing `'agentic'` → `'agentic_text'`, mark
  experimental in spec schema.
- `runPaseo` agentic_tool lane:
  - starts MCP server before lead spawn
  - writes per-actor `opencode.json` into a deterministic
    cwd (`.pluto/runs/<runId>/agents/<actorKey>/`) and spawns
    the actor with `cwd` set there (per T4-D0 finding;
    `OPENCODE_CONFIG_CONTENT` env stays as fallback only)
  - cleans up the per-actor cwd on run termination
  - never calls `extractDirective`
  - drives turn end on first mutating tool call (or no-progress)
  - terminal signal = `pluto_complete_run` tool call
  - delegation pointer logic identical, source signal is now a
    tool call, not a parsed directive
- Lead prompt:
  - drops fenced-JSON schema entirely
  - keeps "Never delegate understanding..." framing line
    (verbatim Claude Code wording)
  - tells lead which tools exist + which is which intent

**Tests:**
- Mock agentic fixture rerun deterministic on `agentic_tool`.
- `agentic_text` regression preserved (one fixture).

**Acceptance:**
- Typecheck + tests green.
- `extractDirective` not called when mode is `agentic_tool`.
- Mock fixture run produces identical event sequence to prior
  agentic mock (closed reducer is unchanged).

### T4-S4 — live smoke + docs + cleanup

**Goal:** land an honest live agentic run on `agentic_tool`,
update docs, retire `agentic_text`.

**Deliverables:**
- New live fixture under `tests/fixtures/live-smoke/<runId>/`
  captured from `pnpm smoke:live` on the agentic mock spec
  flipped to `agentic_tool`.
- New invariant test
  `__tests__/fixtures/agentic-live-invariants.test.ts` (replaces
  the T3 abandoned version):
  - `status === 'succeeded'`
  - lead made ≥ 2 mutating tool calls
  - sub-actor made ≥ 1 mutating tool call
  - ≥ 1 mailbox `completion`/`final` to lead
  - `extractDirective` NOT in tool-mode call graph
  - `events.jsonl` free of parser-repair artifacts
  - `usageStatus` ∈ {'reported', 'unavailable'}
- Docs sync:
  - `docs/harness.md` — agentic_tool architecture (in-process
    MCP, tool surface, lease, no text parsing).
  - `docs/testing-and-evals.md` — three fixture types updated.
  - `packages/pluto-v2-runtime/README.md` — modes table.
  - `README.md` — agentic_tool example.
- Delete `agentic_text` lane code: `paseo-directive.ts`,
  the JSON-fenced schema rendering in `agentic-prompt-builder.ts`,
  and the parse-repair branch in `paseo-adapter.ts`. No fallback
  flag — operator-confirmed full delete (2026-05-08).

**Acceptance:**
- Live run green; invariants pass.
- Diff hygiene: closed schemas unchanged.
- N2 grep gate clean: no `must match exactly` /
  `payload must match exactly`.

## Risk register

1. **`OPENCODE_CONFIG_CONTENT` does not reach detached
   Paseo-spawned sessions.** → T4-D0 is gating; if the env
   route fails, write temp `opencode.json` in actor cwd. If both
   fail, halt T4 per stop condition.
2. **`pluto_complete_run` lead-only vs core manager-only
   authority.** → daemon synthesizes manager-owned request
   internally on lead's behalf. Matches today's
   `runPaseo:173-191`.
3. **Artifact body sidecar becoming a second truth source.** →
   kernel event stays metadata-only; sidecar files are audit
   aids; never replayed.
4. **Out-of-turn actor writes corrupting state.** → daemon
   turn-lease (T4-S2). Authority matrix is the second layer.
5. **Dual-stack drift between `agentic_text` and
   `agentic_tool`.** → coexistence ends in T4-S4.

## Stop conditions (mid-T4 abort triggers)

Halt and re-scope if:

1. T4-D0 cannot prove MCP injection without undocumented hacks.
2. The plan starts requiring closed-schema changes in v2-core
   beyond the existing 5 protocol intents.
3. Serial-turn semantics become inadequate (parallel multi-actor
   writes required).
4. Artifact readback cannot be made deterministic via run-dir
   sidecar.
5. A robust path requires changes to the external Paseo CLI
   itself before Pluto-side work can proceed.

## Status tracker

| Slice    | Status   | Owner    | Notes                                          |
| -------- | -------- | -------- | ---------------------------------------------- |
| T4-D0    | pending  | remote   | MCP injection proof; gating                    |
| T4-S1    | pending  | remote   | in-process tool contract                       |
| T4-S2    | pending  | remote   | MCP server + lease + transport                 |
| T4-S3    | pending  | remote   | driver lane swap; delete `agentic_text` code   |
| T4-S4    | pending  | remote   | live smoke + invariants + docs + cleanup      |

T3 status row in `v2-agentic-orchestration.md` flips to
`superseded-by: T4` in the commit that lands this plan; no
separate T3-CLOSE slice.

## References

- Discovery output (root session
  `ses_1f9340d65ffeCch8uiHWJRNMfJ`).
- GPT Pro architectural review:
  `.learnings/gpt-pro-mcp-architecture-review-2026-05-08.md`.
- Predecessor plan: `docs/plans/active/v2-agentic-orchestration.md`.
- Pluto TRD: model text ≠ state; only validated protocol/tool
  calls produce events.
