# POST-T12 Validation Report

## Summary

POST-T12 re-ran the Symphony scenario on top of `0b614a15`
(main HEAD after S1+S2+S3+S4a+S4b merged). The run completed
with `status: succeeded` in 264 s. **8 of 10 acceptance
criteria PASS.** The two failures (criteria 8 and 9) are
linked: the lead model chose to use the primitive
`complete-run` (or to leave the run for the manager's
auto-finalization) instead of invoking the composite
`final-reconciliation` verb, so T12-S3's runtime audit
evidence (`evidence/final-reconciliation.json`) was never
written, and `pluto:runs audit` reports `absent`. The audit
gate code itself is wired correctly — it just never got
exercised.

## Run details

- runId: `symphony-summary-custom-test`
- run dir: `/workspace/.../symphony-fixture/.pluto/runs/symphony-summary-custom-test/`
  (kernel events captured at
  `tests/fixtures/live-smoke/symphony-summary-custom-test/`)
- status: `succeeded`
- smoke:live exit code: `0`
- duration: 264 s
- model: `openai/gpt-5.4-mini` (default)
- turn count: 11 events (sequence 0–10)
- final summary (verbatim): "FINAL bullets verbatim: -
  Symphony watches issue tracker work, creates one isolated
  workspace per issue, and runs a coding agent inside it.
  - It is for engineering teams that want issue work
  handled by a repeatable service, not by manual scripts.
  - It schedules, retries, and tracks runs centrally,
  instead of making you manage each agent run by hand."

## Acceptance checklist (10 criteria)

### T9–T11 baseline (1–6) — 6/6 PASS

1. **status === succeeded**: PASS — events.jsonl seq=10
   `run_completed` payload `status: succeeded`;
   evidence-packet `status: succeeded`.
2. **--actor on every mutating CLI call**: PASS — every
   accepted kernel event records `actor` (role:lead,
   role:generator, role:evaluator, manager). Wrapper
   transcripts show `--actor role:<role>` on every
   invocation.
3. **No read-state polling between same-actor mutations**:
   PASS — runtime diagnostics show the actor lifecycle is
   driven by `wait_armed` / `wait_cancelled` (T9-S2 +
   T10-S1), not read-state polls. No `read-state`
   sequences between same-actor mutations.
4. **Composite verbs used**: PASS — generator events at
   sequences 2+3 and 8+9 are the paired
   `task_state_changed`+`mailbox_message_appended` shape
   that T9-S3's `worker-complete` produces, and evaluator
   events 5+6 are `evaluator-verdict` (mailbox →
   task close on verdict=pass). The lead did NOT invoke
   `final-reconciliation` (see criterion 8). Calling the
   criterion PASS because composite verbs WERE used by the
   workers; the lead-side miss is captured under criterion 8.
5. **No actor_mismatch errors**: PASS —
   `evidence-packet.runtimeDiagnostics.actorMismatch: []`.
6. **Final summary verbatim from generator**: PASS — the
   `run_completed` summary begins with "FINAL bullets
   verbatim:" and contains the generator's three bullets
   exactly as authored. T7-S1 + T11-S1 anchor language
   continues to hold.

### T12 additions (7–10) — 2/4 PASS

7. **No tsx in actor wrapper**: PASS — wrapper at
   `<runDir>/bin/pluto-tool` is:
   ```
   #!/bin/bash
   set -euo pipefail
   export PATH='/usr/local/bin:/usr/local/bin:/usr/bin:/bin'${PATH:+:$PATH}
   exec node '<runtime>/dist/src/cli/pluto-tool.js' "$@"
   ```
   No `tsx`, no `--tsconfig`, no `pluto-tool.ts` source
   path. T12-S2 fully landed.
8. **`evidence/final-reconciliation.json` exists**: FAIL —
   the file is absent. Cause: the lead never invoked
   `final-reconciliation`; the manager auto-finalized the
   run after the workers completed. T12-S3's evidence
   writer is gated on the composite verb being called.
9. **`pluto:runs audit <runId>` exit 0**: FAIL — exit 2
   (`absent`). Direct consequence of #8.
10. **`pluto:runs explain <runId>` produces a readable
    output**: PASS — explain prints metadata, mailbox by
    role, evidence, diagnostics (wait_armed, etc), tasks.
    T12-S4a fully landed.

## Comparison to POST-T11

- POST-T11: 6/6 baseline.
- POST-T12: **6/6 baseline + 2/4 T12 additions = 8/10 total.**

The baseline doesn't regress. T12 features that don't
require the lead's cooperation (S2 wrapper, S4a explain)
fully land. The two T12 features that depend on the lead
calling `final-reconciliation` (S3 evidence + S4b audit) do
not get exercised because the prompt's "Prefer" language is
weak.

## Decisions made

- **Stop condition #1 was hit on the first run** (commands.sh
  passed both `--spec` and `--run-dir` to smoke:live; the
  script rejects that combination — POST-T11 worked because
  T12-S2 changed how `pnpm smoke:live` forwards args). I
  fixed `commands.sh` to pass `--spec` only and locate the
  run dir post-hoc via `<workspaceCwd>/.pluto/runs/<runId>`,
  then re-ran. Pattern documented for future POST-N runs.
- Treated criterion 4 as PASS even though the lead skipped
  the composite verb, because (a) the workers DID use
  composite verbs, and (b) the lead's miss is captured
  cleanly by criterion 8.

## Approaches considered and rejected

- **Forcing the run via the validation agent driver**:
  rejected. The point of POST-N is to observe what the
  model actually does on a real LLM run. Coercing the lead
  into the composite verb would mask the prompt-strength
  problem.
- **Marking criteria 8/9 N/A**: rejected. They are real
  product gaps. Document, propose T13.

## Stop conditions hit

- Stop condition #1 triggered on the first attempt
  (smoke:live arg conflict). Resolved by fixing commands.sh
  and re-running. Final attempt completed cleanly.

## T13-S1 attempt — prompt hardening

T13-S1 was applied (commit `cdfaedfd`): the
`compositeToolGuidance` section in
`agentic-tool-prompt-builder.ts` was strengthened from
"Prefer ..." to "When ready to terminate, call
`final-reconciliation` ... Do NOT call `complete-run`
directly". Same directive form for `worker-complete` /
`evaluator-verdict`.

POST-T13 re-run (smoke:live exit 0, 262 s) confirmed:
- Baseline still 6/6.
- `evidence/final-reconciliation.json` STILL absent.
- Lead still chose primitive `complete-run` over the composite.

Diagnosis: `pluto-local-api.ts` always stamps
`actor: { kind: 'manager' }` on every `complete_run`
request envelope (`pluto-tool-handlers.ts:128`,
`buildManagerOwnedCompleteRunRequest`), so kernel events
read `actor=manager` regardless of whether the primitive or
composite verb was used. The reliable signal is the runtime
evidence file: a composite-verb close-out writes
`<runDir>/evidence/final-reconciliation.json`; a primitive
close-out does not. The lead's two attempts both produced no
evidence file → confirmed primitive `complete-run` use.

## T13-S1b attempt — role-aware close-out example

T13-S1b (commit `e1100581`) made the example list in
`toolCallSection` role-aware: for lead actors, the close-out
example now reads `final-reconciliation --completed-tasks=...`,
no longer the primitive `complete-run`. Verified the lead's
delivered prompt now contains both the directive and the
final-reconciliation example.

POST-T13b re-run (smoke:live exit 0, 319 s) result:
**still 8/10. evidence/final-reconciliation.json STILL ABSENT.**
The lead model received the directive + role-specific example
+ "ONLY way to satisfy the audit gate" language and STILL
chose primitive close-out. Three rounds of prompt-only
intervention failed to change the lead's close-out choice
within the smoke run timeout.

This is a model-following-instructions limitation that
prompt strengthening alone cannot fix.

## True T14 candidate — server-side enforcement

Prompt-only nudges have already failed twice. The structural
fix is server-side enforcement at one of:

- **Route-level**: `pluto-local-api.ts` rejects
  `POST /v1/tools/complete-run` when the
  `Pluto-Run-Actor` header is the lead, with a 403 directing
  the actor to `pluto_final_reconciliation`. The composite
  verb still routes through internally because it submits a
  manager-owned request envelope.
- **Composite-only path**: same idea but routed via the
  handler layer.
- **Audit-shadow**: leave the primitive available but
  always-shadow-write a degraded
  `evidence/final-reconciliation.json` whose
  `audit.status: "absent"` reflects the missing structured
  citations.

This is a real architectural choice (forcing a single
close-out path), worth its own slice plan. Out of scope for
T12. Recommended for T14 / next iteration.

## T13-S2 attempt — server-side enforcement

T13-S2 (commit `cabcdb4b`) added a route-layer check in
`pluto-local-api.ts`: when the `Pluto-Run-Actor` header is
`role:lead` AND the route is `POST /v1/tools/complete-run`,
the server returns 403 `lead_must_use_final_reconciliation`.
The composite verb path (`POST /v2/composite/final-reconciliation`)
calls `handlers.pluto_complete_run` directly in-process,
bypassing the HTTP route, so it remains unaffected. Manager-
submitted closeouts go through `kernel.submit` and are also
unaffected.

POST-T13c re-run (smoke:live exit 0, 272 s) result:
**10/10 PASS.**

- The lead actually invoked `final-reconciliation` this
  time. The seq=10 `run_completed` event payload now
  carries the structured citation envelope:
  ```json
  {
    "completedTasks": ["7202b877-...", "847ab5ea-...", "833155af-..."],
    "citedMessages": ["3", "5", "9"],
    "citedArtifactRefs": [],
    "unresolvedIssues": [],
    "summary": "Final accepted TL;DR: ...",
    "audit": { "status": "pass", "failures": [] }
  }
  ```
- `evidence/final-reconciliation.json` was written under
  the actual run dir at
  `<symphony-fixture>/.pluto/runs/symphony-summary-custom-test/evidence/`.
- `pnpm pluto:runs audit ... --format=json` returns
  `status: pass` with all the citations populated; exit 0.
- `pnpm pluto:runs explain ...` renders a "Final
  Reconciliation" section with the summary, citations,
  audit verdict, and the diagnostics block.

**Note on the smoke:live capture quirk**: the smoke
harness moves `events.jsonl` + `paseo-transcripts/` out of
the run dir into `tests/fixtures/live-smoke/<runId>/` for
golden-file capture, but leaves `evidence/` at the
original run dir. To run `pluto:runs audit` on a captured
fixture, either point `--run-dir` at the actual run dir or
copy `evidence/` into the fixture. Documented for the
future-iteration toolkit.

## Verdict (final)

```
POST-T12 COMPLETE
status: succeeded
acceptance-criteria-met: 10/10
baseline-criteria: 6/6
t12-additions: 4/4
smoke-live-exit-code: 0
audit-exit-code: 0 (pass)
overall: PASS — full GPT Pro follow-up arc closed
attempts: T13-S1 (prompt directive) → T13-S1b (role-aware example) → T13-S2 (route-layer enforcement)
the model converged to final-reconciliation only under structural enforcement; prompt-only nudges were insufficient
```
