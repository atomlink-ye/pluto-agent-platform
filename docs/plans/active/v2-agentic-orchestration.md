# Pluto v2 — Agentic Orchestration (T1–T3)

> **Status:** in progress, 2026-05-08.
> **Authority:** this file is the canonical plan. Conflicts with
> bundle docs / acceptance.md → plan wins.
> **Inputs:** local OpenCode Companion discovery
> (ses_1fa8519fa…, READY_TO_PLAN) + external GPT Pro reference
> review at `.learnings/gpt-pro-agentic-iteration-feedback-2026-05-08.md`.

## Context

S1–S7 of the v2 rewrite are complete (`main` @ `a98fd8d`). The
post-S7 live smoke shows the v2 harness exterior is sound (closed
schemas, kernel + replay, paseo CLI driver, evidence packet,
fixture capture) BUT the live run is **not actually agentic**:

- `packages/pluto-v2-runtime/src/adapters/paseo/paseo-adapter.ts:117-176`
  contains a hardcoded `phasePlan()` that prescribes both the
  next actor and the directive payload verbatim. Every prompt
  includes the literal JSON the LLM "must match exactly".
- AuthoredSpec has no user-task field; `pluto:run --spec`
  executes a v2 harness scaffold, not "let agent team complete a
  task".
- `src/cli/v2-cli-bridge.ts` writes only `evidence-packet.json` +
  transcripts — `smoke-live.ts` writes a strictly more complete
  fixture (events.jsonl / projections / final-report / usage). The
  production CLI is a regression vs the smoke harness.
- `usage-summary.json` reports `tokens=0 / cost=$0` despite real
  LLM responses (paseo CLI's `usageEstimate` not wired).

This iteration removes the v1.6 residue and ships agentic
team-lead orchestration. Operator's binding intent (verbatim):

> Playbook 给 leader 只是看一下的，他只是要参考里面的一些步骤,
> 但他可以应该要完全自主地进行决策。下一步就是能够让他真正按
> Claude agent teams 的架构真正给用起来,而不是做一些写死的东西。
> 每一个 actor 完了，他都应该发消息或者其他通知方式，而不是通过
> 一些写死的 workflow 来决定。

## Hard architecture decisions (binding for T1–T3)

(Picked from OpenCode discovery; GPT Pro reconciliation noted.)

1. **Lead = `kind: 'role', role: 'lead'`.** `manager` stays
   declared but only as the protocol-level closer that
   `runPaseo` synthesizes for `complete_run` today. No new
   `leadActor` selector field.
2. **One directive per turn.** Multi-directive turns add
   atomicity questions the kernel doesn't solve.
3. **Sub-actor terminates on EITHER terminal task transition OR
   `append_mailbox_message kind: completion|final` to lead.**
4. **No new directive intents.** Existing 5 (`create_task`,
   `change_task_state`, `append_mailbox_message`,
   `publish_artifact`, `complete_run`) cover delegation + reporting
   + completion. Closed schema in `@pluto/v2-core` stays
   byte-unchanged.
5. **State view = stable compact JSON.** Built from
   `replayAll(events): ReplayViews` + small runtime metadata
   (budgets / rejections / delegation pointer). No raw
   transcripts, no full event log injection.
6. **Budgets:** default `maxTurns = 20`, hard cap 50;
   `maxParseFailuresPerTurn = 2`; `maxKernelRejections = 3`;
   `maxNoProgressTurns = 3`.
7. **Markdown playbook.** Reference material; lead consults via
   prompt injection; no stage YAML, no machine execution.
8. **Parse failure → retry same actor up to budget. Kernel
   rejection → return control to lead with rejection summarized
   in next lead prompt.** Increment kernel-rejection budget per
   rejection.
9. **Deterministic mode opt-in.** Existing 6-phase
   `phasePlan()` stays available behind `runProfile:
   paseo-deterministic` for cheap regression coverage. Agentic
   mode is `runProfile: paseo-agentic`. S4 parity fixture
   byte-untouched.
10. **Two-layer envelope deferred.** GPT Pro's
    `TeamProtocolEnvelope` (worker_complete / evaluator_verdict /
    final_reconciliation) stays as future work. v2 first earns
    the right to richer verbs by demonstrating real agentic flow
    on the existing 5. Memory rule
    `feedback_two_layer_protocol_envelope.md` retained for next
    iteration.

## Slice decomposition

### T1 — Spec + prompt-view foundation + CLI run-directory parity + usage status

**Goal**

Add the minimum runtime-facing AuthoredSpec surface for agentic
orchestration and define the stable serialized prompt view the
adapter (T2) will consume. Fix the reverse-asymmetry where
`pluto:run --spec` writes less than `smoke-live`. Mark unknown
usage as `unavailable` instead of pretending `$0`.

**Deliverables**

1. **AuthoredSpec additive fields** (in
   `packages/pluto-v2-core/src/core/team-context.ts`):
   ```ts
   orchestration?: {
     mode?: 'deterministic' | 'agentic';
     maxTurns?: number;
     maxParseFailuresPerTurn?: number;
     maxKernelRejections?: number;
     maxNoProgressTurns?: number;
   };
   userTask?: string;
   playbookRef?: string;
   ```
   Schema stays `.strict()`. Validation:
   - In agentic mode, declared actors MUST contain
     `{ kind: 'role', role: 'lead' }` AND `{ kind: 'manager' }`,
     `userTask` MUST be non-empty, `playbookRef` MUST resolve to
     a markdown file at load time.
   - In deterministic mode, the new fields are tolerated but
     ignored; existing fixtures remain valid.

2. **Prompt-view helper** (new file under
   `packages/pluto-v2-runtime/src/adapters/paseo/` —
   probably `prompt-view.ts`). Pure function:
   ```ts
   buildPromptView(args: {
     spec: AuthoredSpec;
     events: readonly RunEvent[];
     forActor: ActorRef;
     budgets: { maxTurns, turnIndex, kernelRejections, ... };
     activeDelegation: ActorRef | null;
     lastRejection: { directive, error } | null;
   }): PromptView;
   ```
   Output is a stable JSON shape the adapter (T2) serializes into
   the actor's prompt. Must be deterministic for replay-based
   tests.

3. **Playbook resolver** (new file under
   `packages/pluto-v2-runtime/src/loader/`). Resolves
   `spec.playbookRef` relative to the spec file's directory; reads
   the markdown content; returns a `{ ref, body, sha256 }`
   bundle for fixture / evidence inclusion.

4. **CLI run-directory parity** (`src/cli/v2-cli-bridge.ts`).
   `pluto:run --spec=<path>` MUST write to `.pluto/runs/<runId>/`
   (relative to `--workspace` or cwd):
   - `events.jsonl`
   - `projections/tasks.json`, `projections/mailbox.jsonl`,
     `projections/artifacts.json` (or equivalent shapes from
     v2 ReplayViews)
   - `evidence-packet.json`
   - `final-report.md`
   - `usage-summary.json`
   - `paseo-transcripts/*.txt`

   `V2BridgeResult` extends to include `runDir: string`. Existing
   transcripts/evidencePacketPath fields preserved (additive).

5. **Usage status** (`packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
   and the smoke-live serializer). When all per-turn tokens are
   0, the persisted usage summary MUST flag:
   ```json
   {
     "usageStatus": "unavailable",
     "estimated": false,
     "reportedBy": "paseo.usageEstimate",
     ...
   }
   ```
   Budget gate logic (used by T2): treating unknown as `$0`
   raises a soft warning in evidence; hard cap on `totalCostUsd`
   only applies when `usageStatus === 'reported'`.

**Boundaries**

- Allow: `packages/pluto-v2-core/src/core/team-context.ts`,
  `packages/pluto-v2-core/src/core/spec-compiler.ts`,
  `packages/pluto-v2-runtime/src/adapters/paseo/prompt-view.ts`
  (new), `packages/pluto-v2-runtime/src/loader/`,
  `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
  (additive usage-summary changes only),
  `src/cli/v2-cli-bridge.ts`, `src/cli/run.ts` (only if needed
  for run-dir flag), tests under
  `packages/pluto-v2-{core,runtime}/__tests__/**`,
  `tests/cli/run-runtime-v2-default.test.ts` (additive).
- Deny: `paseo-adapter.ts`, `paseo-directive.ts`,
  `protocol-request.ts`, `run-event.ts`,
  `core/authority.ts`, `core/run-kernel.ts`,
  `projections/**`, `smoke-live.ts`, parity fixture under
  `tests/fixtures/live-smoke/86557df1-*`.

**Acceptance bar (T1)**

- Spec extension fields added; strict schema unbroken; existing
  fixtures parse unchanged.
- Agentic-mode missing-lead / missing-manager / empty-userTask /
  unresolvable-playbookRef each fails with a documented error
  string.
- `buildPromptView` deterministic: same `(spec, events, actor,
  budgets)` → same JSON byte-for-byte; bounded mailbox/event
  tails (≤ 50 items each).
- `pluto:run --spec=<path>` writes the 6 documented outputs
  under `.pluto/runs/<runId>/`. Existing
  `tests/cli/run-runtime-v2-default.test.ts` updated additively
  to assert the new files exist.
- `usage-summary.json` flags `usageStatus: 'unavailable'` when
  per-turn tokens are 0; `'reported'` otherwise.
- Gates: `pnpm --filter @pluto/v2-core typecheck` /
  `pnpm --filter @pluto/v2-runtime typecheck` /
  `pnpm exec tsc -p tsconfig.json --noEmit` /
  `pnpm --filter @pluto/v2-core test` /
  `pnpm --filter @pluto/v2-runtime test` /
  `pnpm test`. All green.
- Diff hygiene: zero changes under `paseo-adapter.ts`, kernel,
  authority, projections, parity fixture.

### T2 — Agentic Paseo adapter (replace `phasePlan` on agentic path)

**Goal**

Replace the hardcoded phase plan with an opt-in agentic adapter
that routes turns by explicit protocol signals + adapter-local
delegation state. Lead reads compact state view + playbook +
user task; chooses one directive per turn; sub-actors do their
work; control returns to lead on terminal signal. Deterministic
mode preserved.

**Deliverables**

1. **Agentic loop in `paseo-adapter.ts`.** Branches on
   `spec.orchestration?.mode === 'agentic'`:
   - **Default current actor:** `kind: 'role', role: 'lead'`.
   - **Delegation pointer:** opens when lead emits
     `create_task` with `ownerActor !== lead` OR
     `append_mailbox_message` with `toActor !== lead`.
   - **Closes** when the delegated actor:
     - drives the bound task to a terminal state
       (`task_state_changed to=completed|cancelled|failed`), OR
     - emits `append_mailbox_message kind=completion|final`
       targeted at lead.
   - **Lead-only delegation in T2.** Sub-actors do not delegate
     onward.
   - **Termination:** lead emits `complete_run`. Driver
     synthesizes `manager` actor `complete_run` event using the
     existing path.

2. **Prompt builder (replaces `buildDirectivePrompt`).** Per
   actor:
   - **Lead:** system instruction (role) + `userTask` verbatim +
     full playbook body (capped) + compact prompt-view JSON
     from T1 + closed directive schema description (5 intents
     + payload shapes) + "decide one directive and emit one
     fenced JSON block".
   - **Sub-actor:** role-specific system instruction + role
     slice of playbook (if present, else full) + compact
     prompt-view JSON scoped to actor's mailbox + assigned
     tasks + closed directive schema description + "decide one
     directive and emit one fenced JSON block".
   - **NO verbatim payload in any prompt.** Tests grep-gate.

3. **Error handling.** Parse failure → retry same actor up to
   `maxParseFailuresPerTurn`; emit a repair prompt. Kernel
   rejection → return control to lead with the rejection
   serialized into the next lead prompt-view; increment
   `kernelRejections`; abort run if budget exceeded.

4. **Budget enforcement.** Driver tracks `turnIndex`,
   `kernelRejections`, `noProgressTurns`. Aborts (and emits
   `complete_run` with `status: 'failed'`) on any cap hit;
   evidence records the failure mode.

5. **Deterministic-mode preservation.** Existing
   `phasePlan()` + `buildDirectivePrompt` reachable when
   `spec.orchestration?.mode !== 'agentic'`; existing tests
   pass unchanged.

**Boundaries**

- Allow: `paseo-adapter.ts`, `paseo-directive.ts` (additive
  parse-mode hardening only — single directive per turn),
  `run-paseo.ts` (driver wiring for budgets / mode plumbing /
  `complete_run` synthesis), new helper files under
  `packages/pluto-v2-runtime/src/adapters/paseo/`,
  `packages/pluto-v2-runtime/__tests__/adapters/paseo/**`,
  new agentic mock scenario under
  `packages/pluto-v2-runtime/test-fixtures/scenarios/`.
- Deny: `protocol-request.ts`, `run-event.ts`,
  `core/authority.ts`, `core/run-kernel.ts`,
  `projections/**`, `smoke-live.ts`, parity fixture.

**Acceptance bar (T2)**

- Grep gate: zero occurrences of `must match exactly` /
  `payload must match exactly` in agentic-mode prompt code or
  prompts emitted by tests targeting agentic mode. (Memory rule
  `feedback_no_verbatim_payload_prompts.md`.)
- One directive per turn enforced (`extractDirective` returns
  exactly one parsed directive; multiple JSON blocks → parse
  failure; arrays → parse failure).
- Deterministic-mode tests in `paseo-adapter.test.ts` pass
  byte-unchanged.
- Agentic mock scenario tests cover:
  - lead task delegation,
  - lead mailbox delegation,
  - sub-actor retains turn while delegated task is running,
  - return to lead on terminal task transition,
  - return to lead on `mailbox_message_appended kind=completion`,
  - parse-repair retry within budget,
  - kernel rejection → next-turn lead with rejection in view,
  - `maxTurns` exceeded → `complete_run status=failed`,
  - `maxNoProgressTurns` exceeded → fail.
- Gates: `pnpm --filter @pluto/v2-runtime typecheck` /
  `pnpm --filter @pluto/v2-runtime test` /
  `pnpm exec tsc -p tsconfig.json --noEmit` /
  `pnpm test` all green.
- Diff hygiene: zero changes under `@pluto/v2-core/src/`,
  zero changes under `tests/fixtures/live-smoke/86557df1-*`.

### T3 — Smoke-live + agentic fixture + docs sync

**Goal**

Make `pnpm smoke:live` exercise the new agentic mode with a
real user task; capture a fresh agentic live fixture; sync
documentation (including the post-S7 doc drift in the
v2-runtime README); preserve the S4 parity fixture as the
exact replay oracle.

**Deliverables**

1. **`smoke-live.ts` overhaul.** Read `userTask`, `playbookRef`,
   `orchestration.mode` from the spec. Write the full run
   directory (already implemented in T1) to a fixture path
   under `tests/fixtures/live-smoke/<runId>/`. Capture the
   resolved playbook (body + sha256) into the fixture for
   audit.

2. **Agentic mock fixture** under
   `packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-agentic-mock/`
   — deterministic, no LLM. Used by T2 unit tests.

3. **Agentic live fixture** under
   `tests/fixtures/live-smoke/<new-runId>/` captured from a real
   `pnpm smoke:live` run on the warm sandbox. Validated by
   invariant assertions only (status=succeeded, run_completed
   reached, lead emitted ≥1 delegation, ≥1 mailbox message
   from sub-actor back to lead, evidence-packet matches v2
   shape) — NOT byte parity.

4. **Doc sync** (per GPT Pro G):
   - `packages/pluto-v2-runtime/README.md` — drop "fake-runtime
     only" / "live Paseo deferred to S5" stale claims; document
     paseo agentic / deterministic modes; reference T1 spec
     extensions.
   - `docs/harness.md` — add agentic mode section.
   - `docs/testing-and-evals.md` — describe deterministic mock
     fixture vs live invariant fixture vs S4 parity fixture.
   - `docs/mvp-alpha.md` — note user task input is now
     supported.
   - `README.md` — `pluto:run --spec` example showing user
     task + playbook.

5. **No changes to v2-core.** No changes to S4 parity fixture.

**Boundaries**

- Allow: `packages/pluto-v2-runtime/scripts/smoke-live.ts`,
  `packages/pluto-v2-runtime/test-fixtures/scenarios/`,
  `packages/pluto-v2-runtime/README.md`, doc files in scope,
  new `tests/fixtures/live-smoke/<new-runId>/`, `README.md`.
- Deny: `packages/pluto-v2-core/**`, `paseo-adapter.ts`,
  `tests/fixtures/live-smoke/86557df1-*`.

**Acceptance bar (T3)**

- `pnpm smoke:live` against an agentic spec produces full run
  directory with the documented files; resolved playbook is in
  the fixture.
- New agentic mock fixture is exact (deterministic) + parses;
  used by ≥1 T2 unit test.
- New agentic live fixture validates against invariants only;
  S4 parity fixture untouched (byte-equal pre/post).
- 5 doc files updated; v2-runtime README no longer claims
  "fake-runtime only".
- Gates: `pnpm test` / `pnpm smoke:live` (with
  `R8_BYPASS=ok` if infrastructure debug needed per memory
  rule) / diff gate `git diff --stat main..HEAD --
  tests/fixtures/live-smoke/86557df1-` empty.

## Out of scope (deferred)

- **`TeamProtocolEnvelope` translator** (worker_complete /
  evaluator_verdict / final_reconciliation / spawn_request /
  revision_request). Defer to next iteration; closed kernel
  schema stays narrow until a real workflow demands richer
  verbs. Memory rule retained.
- **Sub-actor onward delegation** (sub-actor delegates to
  another sub-actor). T2 enforces lead-only delegation; defer.
- **RoleCitation / WorkerComplete / EvaluatorVerdict typed
  evidence kinds.** Current `EvidencePacket.citations` shape
  retains `run_started + run_completed`. New citation types
  arrive with the envelope translator.
- **Multi-directive turns** (atomic task batches).
- **Persistent worker agents across runs** / cross-run
  resumability.
- **Real-time per-provider usage extraction.** T1 only flags
  unavailable; full provider usage parsing is its own slice.

## Stop conditions (any → STOP_AND_ASK)

- Need to add a 6th directive intent or a new run-event kind.
- Need to change the canonical authority matrix.
- Need to let lead persist `complete_run` directly instead of
  via the manager closure path.
- Need multi-directive atomic turns.
- Need machine-executable playbook (stages / branching).
- Need sub-actor-to-sub-actor delegation in T2.
- Need to raise budgets above the documented hard caps just to
  make the representative scenario complete.

## Status tracker

| Slice | State | Branch | Evidence |
|---|---|---|---|
| T1 | Done | `main` @ `b3873ce` | AuthoredSpec extensions (`orchestration?`, `userTask?`, `playbookRef?`) closed-strict + agentic-mode validation (lead/manager/userTask/playbookRef rejection paths). NEW `prompt-view.ts` (pure function from `replayAll(events)` projections; mailbox cap 50; sub-actor scoping; byte-stable). NEW `playbook-resolver.ts` (markdown loader; sha256). NEW shared evidence helpers `final-report-builder.ts` + `usage-summary-builder.ts` factored out of smoke-live; `usageStatus: 'reported'\|'unavailable'` flag added. CLI `pluto:run --spec` now writes full `.pluto/runs/<runId>/` directory (events.jsonl + projections + evidence + final-report + usage + transcripts) on BOTH success and failure paths; `--workspace` defaulting respected. Loader switched to `yaml.DEFAULT_SCHEMA` so numeric orchestration budgets parse correctly. Loader-typed `LoadedAuthoredSpec` carries playbook metadata (no more cast-only field). Total tests: core 186→196 (+10), runtime 65→85 (+20), root 32→34 (+2). 4 commits ahead of S7: `3824cac` initial + `ac0aa55` 7-objection fix-up + `de4f84f` closure artifacts + `b3873ce` REPORT wording. Discovery (local OpenCode @oracle + @council, READY_TO_PLAN; reconciled with external GPT Pro independent review). Acceptance R1 NEEDS_FIX (7 objections: playbook-metadata cast, run-dir workspace path, failed-run dir, YAML FAILSAFE, gate-6 stat assertion, diff-hygiene list, missing closure proofs) → R2 READY_TO_MERGE 2026-05-08. Zero v2-core kernel mutation; zero `paseo-adapter.ts` / `smoke-live.ts` / parity-fixture mutation |
| T2 | Done | `main` @ `ddb495b` | Hardcoded `phasePlan()` v1.6 residue removed on agentic path; deterministic mode preserved as opt-in regression lane (source byte-equal). Lead-driven loop: default `role:lead`; delegation pointer opens on `create_task ownerActor!=lead` or `append_mailbox_message toActor!=lead`; closes only on bound terminal task transition (task-opened) OR mailbox completion/final to lead (mailbox-opened). Sub-actor cannot open onward delegation; sub-actor `complete_run` rejected → returns control to lead with `lastRejection`. NEW agentic-loop-state.ts (additive nullable fields on single `PaseoAdapterState`), agentic-scheduler.ts (pure `pickNextActor`), agentic-prompt-builder.ts (lead variant: user-task + full playbook + state JSON; sub-actor variant: role-slice playbook + filtered state + `userTask: null` SCRUB). NEW agentic mock fixture `hello-team-agentic-mock` (scenario.yaml + playbook.md). `extractDirective` rejects ≥2 fenced JSON blocks (multi-fence). Parse-repair adapter-local (no kernel events polluted); kernel-rejection budget surfaces `lastRejection` in next lead prompt. CLI dispatch wired in `runPaseo` (Alternative A; v2-cli-bridge.ts UNCHANGED) — `pluto:run --spec=<agentic.yaml>` truly activates agentic mode. Total tests: core 196 (unchanged) / runtime 85→104 (+19 agentic loop + scheduler + prompt-builder + multi-fence-rejection + repair) / root 34→35 (+1 agentic CLI integration). 2 commits ahead of T1: `a300f35` initial T2 (BLOCKED on push auth → local apply) + `ddb495b` 7-objection fix-up. Acceptance R1 NEEDS_FIX (7 obj: CLI not wired / sub-actor complete_run / userTask leak / det path source mod / state union / scheduler wildcard close / parse-repair as kernel event) → R2 READY_TO_MERGE 2026-05-08. N2 grep gate clean (`must match exactly`/`payload must match exactly` 0 matches in agentic code/tests). Zero v2-core kernel mutation; zero `smoke-live.ts` mutation; zero parity-fixture mutation; zero T1 surface mutation |
| T3 | Not started | — | — |

## Iteration loop (per slice)

For T1 → T2 → T3 in order:

1. Build remote bundle under
   `tasks/remote/pluto-v2-<TX>-<topic>-<date>/` (HANDOFF /
   acceptance / prompt / env-contract / context-index /
   commands.sh).
2. Sync bundle to sandbox via daytona exec (tar+base64).
3. Dispatch remote root manager via `paseo run --host $HOST`
   (opencode/openai/gpt-5.4, orchestrator mode, thinking high).
4. Bg wait. Pull artifacts.
5. Local acceptance review (OpenCode Companion @oracle +
   @council).
6. NEEDS_FIX → delegate fix to fresh OpenCode Companion or
   inline if mechanical.
7. READY_TO_MERGE → fast-forward merge into main + close
   status row + push.

## Last updated

2026-05-08 — T2 merged at `main` @ `ddb495b`; T3 next.
