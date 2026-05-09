# Pluto v2 — Craft fidelity + telemetry tightening (T7)

> [!NOTE]
> **Per-slice reports** (in execution order):
> - [T7-S1 — lead craft-fidelity role anchor](../../../tasks/remote/pluto-v2-t7-s1-craft-fidelity-20260509/artifacts/REPORT.md)
> - [T7-S2 — null usage totals when telemetry unavailable](../../../tasks/remote/pluto-v2-t7-s2-telemetry-totals-20260509/artifacts/REPORT.md)
> - [T7-S3 — wait disconnect triage](../../../tasks/remote/pluto-v2-t7-s3-wait-disconnect-20260509/artifacts/REPORT.md) *(in flight)*
>
> **Predecessor plan:** [T6 actor bridge fix](v2-actor-bridge-fix.md)
>
> **POST-T6 fixture (input):** `tests/fixtures/live-smoke/post-t5-poet-critic-haiku/` — captured during POST-T5; the same path was overwritten by POST-T6's successful run before re-capture.

> **Status:** drafted 2026-05-09 from POST-T6 validation finding (PARTIAL).
> **Authority:** this file is canonical for T7.
> **Predecessor:** T6 actor-bridge-fix. POST-T6 ran the poet/critic
> haiku scenario end-to-end (status: succeeded, 11 events, 3 tasks
> all `completed`) but the LLM lead violated the playbook's craft
> boundary by authoring its own haiku at run closeout instead of
> echoing the poet's revision.

## Why T7 exists

POST-T6 verdict (OC + manager): PARTIAL.

Headline orchestration works — the actor bridge + role anchor +
self-check + smoke acceptance all behave as designed. But three
sub-issues remain:

1. **Craft fidelity**: the lead role-anchored prompt does not
   forbid "authoring craft yourself"; only "using external control
   planes". The poet/critic playbook explicitly said "Lead never
   writes the haiku" but the lead's `complete_run` summary used a
   different haiku than the poet's final revision. The lead
   crossed the craft boundary at closeout.
2. **Telemetry partial**: T6-S6 made `usageStatus: 'unavailable'`
   honest, and per-turn fields use `null`, but the aggregate totals
   (`totalInputTokens` / `totalOutputTokens` / `totalCostUsd`) are
   still `0` not `null`. Inconsistent.
3. **Wait disconnect rough edge**: `runtimeDiagnostics.waitTraces`
   shows `wait_cancelled` with reason `http_disconnect` between
   successful operations. The run recovered each time, but it
   suggests a transport timeout that should be triaged.

## What works (do NOT regress)

- Bridge wrapper materialization + prompt path threading
- Bootstrap self-check / fail-fast
- Lead role-anchor against external piloting
- Driver-synthesized task close-out
- Wait registry with shutdown safety
- Smoke-live acceptance criteria + POST-T5 fixture as regression
- All slice + root tests (currently 207/209 + 37/37 on `main`)

## Slices

### T7-S1 — Craft-fidelity role anchor

**Goal:** the lead bootstrap prompt explicitly forbids the lead
from authoring craft (poems, code, designs, etc.) themselves at
ANY point — including the `complete_run` summary. The summary
must echo the delegated actor's final accepted output verbatim.

**Deliverables:**
- Modify `agentic-tool-prompt-builder.ts` role anchor section to
  add a "Craft fidelity" paragraph for `lead` role only:
  ```
  As lead, you orchestrate craft — you never produce craft.
  When you complete the run, your summary must quote the
  delegated actor's final accepted output verbatim. Do not
  rewrite, paraphrase, or "improve" sub-actor output in your
  summary or anywhere else.
  ```
- Strengthen poet/critic playbook (and any future user playbooks
  via documentation) to follow the same pattern.
- Tests: assert the lead bootstrap prompt contains the craft-fidelity
  language; assert sub-actor bootstrap prompts do NOT.

**Cost:** ~50-100 LOC, 1-2 files.

### T7-S2 — Finish telemetry truthfulness

**Goal:** when `usageStatus === 'unavailable'`, aggregate totals
report `null` not `0`, consistent with per-turn fields.

**Deliverables:**
- Modify `usage-summary-builder.ts` to emit `null` for totals when
  status is `unavailable` (or `0` for explicitly observed-zero
  measurements when status is `available`).
- Update consumers / tests that asserted `0`.
- Update `final-report-builder.ts` if it formats totals.

**Cost:** ~50-150 LOC, 2-4 files.

### T7-S3 — Wait disconnect triage + fix

**Goal:** characterize and fix the `wait_cancelled http_disconnect`
events seen on `wait` traces. Decide if it's a benign client-side
timeout the runtime can absorb, or a real bug that should never
fire on a healthy run.

**Approach:**
- Reproduce in a unit test if possible (drive a real `wait` HTTP
  call and observe its disconnect window vs server timeout).
- If it's a Pluto-side bug (e.g. server closes connection too
  early), fix it.
- If it's a paseo-client-side disconnect that's safe (the registry
  re-arms cleanly on subsequent calls), at least suppress the
  noisy trace OR rename the reason to `client_idle_disconnect` so
  it isn't conflated with abort-class cancellations.

**Cost:** ~150-300 LOC, 2-4 files. May produce a minor doc note.

## Risk register

1. T7-S1 risk: making the lead anchor stricter could break
   workflows where the lead IS supposed to summarize creatively.
   Mitigation: scope the new anchor to "craft" specifically, not
   to all summarization. Test on hello-team-mock (which has no
   craft) to confirm no regression.
2. T7-S2 risk: changing totals from `0` to `null` may break
   external consumers. Mitigation: keep `0` when status is
   `available` and a turn truly reported zero usage; only switch
   to `null` for `unavailable`.
3. T7-S3 risk: the wait disconnect may be a paseo-client behavior
   we can't fix in Pluto. Acceptable outcome: rename + document
   without runtime change.

## Stop conditions

1. T7-S1 prompt change requires kernel changes → STOP.
2. T7-S3 reproduces a kernel-level race → STOP, surface BLOCKED.

## What's NOT in T7

- New scenarios beyond poet/critic.
- Performance work.
- Anything from T5-S5 (open role schema — still deferred).
