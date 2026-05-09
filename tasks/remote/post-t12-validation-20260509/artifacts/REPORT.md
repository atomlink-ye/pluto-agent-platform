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

## T13 candidate

**T13-S1 — final-reconciliation prompt hardening**

- Change `agentic-tool-prompt-builder.ts:283` from
  "Prefer ..." to a directive: "End the run by calling
  `final-reconciliation`. Do NOT call `complete-run`
  directly — the composite verb wraps it with the audit
  gate."
- Optionally drop the `complete-run --status=succeeded`
  example from the lead's example list (line 265), or mark
  it explicitly "Lead: do not use directly; use
  final-reconciliation".
- Same prompt strengthening for generator (`worker-complete`)
  and evaluator (`evaluator-verdict`).
- Re-run POST-T13 expecting 10/10.

If T13-S1 prompt hardening is insufficient, T14 can add
server-side enforcement (route reject `complete-run` from a
lead actor with a clear error pointing to
`final-reconciliation`).

## Verdict

```
POST-T12 COMPLETE
status: succeeded
acceptance-criteria-met: 8/10
baseline-criteria: 6/6
t12-additions: 2/4
smoke-live-exit-code: 0
audit-exit-code: 2 (absent)
overall: PARTIAL — T13-S1 candidate identified
```
