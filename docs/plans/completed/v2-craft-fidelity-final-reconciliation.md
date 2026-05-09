# Pluto v2 — T11 Craft Fidelity in `final-reconciliation`

> [!NOTE]
> **Per-slice reports** (in execution order):
> - T11-S1 — verbatim-anchor for `final-reconciliation` lead prompt + auto-derive from cited messages *(in flight)*
>
> **Predecessors:** T9 (Harness Workflow Hardening) + T10 (Wait Disconnect Resilience), both merged.
>
> **Trigger:** POST-T10 returned **PARTIAL 5/6**. Criterion 3 (T10's regression target) is now PASS. The new failure is criterion 6 (final summary verbatim from generator). The lead's `final-reconciliation` summary contained "Symphony is a long-running service ..." while the generator's last completion bullets were "Symphony is a long-running scheduler/runner ...". The lead rephrased instead of preserving.

> **Status:** drafted 2026-05-09 from POST-T10 PARTIAL evidence.
> **Authority:** this file is canonical for T11.

## Why T11 exists

T7-S1 added a "VERBATIM" craft-fidelity anchor to the lead's
prompt for the primitive `complete-run` tool: the lead must
quote the generator's bullets exactly, not rewrite. POST-T7,
POST-T8, POST-T9 all confirmed this worked.

T9-S3 added the composite verb `final-reconciliation` as the
preferred path for the lead. The verb translates server-side
to `complete-run` but the LEAD'S CHOICE of what `--summary`
text to pass is still LLM-authored. The bootstrap prompt for
`final-reconciliation` did NOT carry the same VERBATIM anchor.

POST-T10 evidence:
- generator's last completion (events.jsonl:10): bullets starting "Symphony is a long-running scheduler/runner ..."
- lead's `final-reconciliation` summary (events.jsonl:11): bullets starting "Symphony is a long-running service ..."

The lead rephrased. T11-S1 fixes this.

(POST-T9 happened to PASS criterion 6 by LLM-stochastic luck;
POST-T10 didn't. The fix makes it deterministic.)

## What works (do NOT regress)

- All T9 slices: identity, lifecycle, composite verbs, token binding, tooling.
- All T10 slices: silent wait re-arm, polling gate, cross-package imports.
- Criterion 3 (no read-state polling): now passing per POST-T10.

## Slices

### T11-S1 — Verbatim anchor for `final-reconciliation` + auto-derive option

**Goal:** when the lead invokes `final-reconciliation`, the
`--summary` argument MUST contain the generator's last
completion message bullets verbatim. Either:
- (A) **Anchor in the prompt**: the lead's bootstrap prompt for
  `final-reconciliation` includes the same VERBATIM language
  T7-S1 added for `complete-run`. The lead is responsible for
  copying the generator's text.
- (B) **Auto-derive in the composite layer**: the
  `final-reconciliation` route reads the `cited-messages` and
  composes the summary from those messages' bodies, NOT from
  the lead's `--summary` argument. The lead picks WHICH messages
  to cite; the server composes the verbatim text.

**(B) is more robust** (LLM can't accidentally rephrase) but
requires structural changes to the composite-tools.ts route
and the lead's prompt about HOW to use the verb. Risk: complex
scenarios may have multiple valid summary shapes (e.g., synthesizing
across multiple completion messages).

**(A) is simpler** but relies on LLM compliance — same failure
mode T7-S1 already mitigated for `complete-run`. The advantage:
T7-S1's anchor language is known to work in practice.

**Recommendation:** ship (A) as the immediate fix; defer (B) to
a future hardening slice. T11-S1 = (A).

**Approach (A):**

- `packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts`
  — extend the lead's bootstrap prompt for `final-reconciliation`
  to include the same VERBATIM language used for the primitive
  `complete-run`. Specifically: "the `--summary` argument MUST
  contain the generator's last completion message bullets
  EXACTLY as the generator wrote them. Do not paraphrase, do
  not reformat, do not synthesize. Copy verbatim from the
  mailbox."
- (Optional belt-and-suspenders) Add a server-side check in
  `composite-tools.ts` that warns (NOT errors — this is craft,
  not auth) if `--summary` text doesn't substring-contain at
  least 50% of the cited message bodies. Logs a `final_reconciliation_summary_mismatch`
  diagnostic trace. This is a soft signal for future
  smoke-acceptance hardening.

**Deliverables:**
- `agentic-tool-prompt-builder.ts`: VERBATIM anchor in lead's `final-reconciliation` prompt section.
- `composite-tools.ts` (optional): summary-vs-cited substring check + diagnostic trace.
- Tests: prompt-builder test asserts VERBATIM language is present in lead's `final-reconciliation` section.
- Tests: composite-tools test for the substring-mismatch diagnostic if shipped.

**Files in scope (allowlist):**
- `packages/pluto-v2-runtime/src/adapters/paseo/agentic-tool-prompt-builder.ts`
- `packages/pluto-v2-runtime/src/api/composite-tools.ts` (only if shipping the soft check)
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/agentic-tool-prompt-builder.test.ts`
- `packages/pluto-v2-runtime/__tests__/api/composite-tools.test.ts` (only if shipping the soft check)
- `tasks/remote/pluto-v2-t11-s1-craft-fidelity-final-reconciliation-20260509/**`

**Cost:** ~150-300 LOC.

**Stop condition:** if the soft-check approach produces noise
on existing fixtures, drop the soft check; ship only the prompt
anchor (which is the core fix).

## Risk register

1. T11-S1: prompt-only anchor relies on LLM compliance, same
   risk T7-S1 had. Mitigation: stay close to T7-S1's exact
   wording (proven to work for primitive `complete-run`).
2. T11-S1: soft-check could false-positive on legitimate
   summaries. Mitigation: 50% substring threshold OR drop the
   check if noisy.

## Stop conditions (mid-T11 abort triggers)

1. Any slice requires v2-core kernel mutation → STOP.
2. Adding the anchor cascades to > 3 predecessor source files → STOP, narrow.
3. POST-T11 still fails criterion 6 → escalate to (B) auto-derive in T12.

## What's NOT in T11

- (B) auto-derive in composite layer — deferred unless (A) fails.
- Final-reconciliation audit gate (H4 — citation validation) — separate iteration.
- Open role schema (H5) — separate iteration.
