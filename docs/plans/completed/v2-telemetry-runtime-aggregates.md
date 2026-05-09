# Pluto v2 — Telemetry runtime aggregates (T8)

> [!NOTE]
> **Per-slice reports** (in execution order):
> - [T8-S1 — null aggregate totals through runPaseo + byActor/byModel/perTurn](../../../tasks/remote/pluto-v2-t8-s1-null-aggregates-20260509/artifacts/REPORT.md) *(in flight)*
>
> **Predecessor plan:** [T7 craft fidelity + telemetry tightening](v2-craft-fidelity-and-telemetry.md) — T7-S2 fixed null semantics in the builder but did not propagate through the real paseo runtime aggregation.

> **Status:** drafted 2026-05-09 from POST-T7 validation finding (PARTIAL).
> **Authority:** this file is canonical for T8.

## Why T8 exists

POST-T7 validation showed:
- T7-S1 (craft fidelity): PASS (lead summary echoed generator's verbatim).
- T7-S3 (wait disconnect): PASS (`client_idle_disconnect` classified).
- T7-S2 (telemetry totals null): **NEEDS_FIX** — the runtime path
  on real paseo still emits `0` for unavailable totals.

Extended evidence from POST-T7 fixture
(`/tmp/post-t7-validation/artifacts/post-t7-poet-critic-haiku/usage-summary.json`):
- `usageStatus: 'unavailable'` ✓
- `totalInputTokens: 0` ✗ (should be null)
- `totalOutputTokens: 0` ✗ (should be null)
- `totalTokens: 0` ✗
- `totalCostUsd: 0` ✗
- `byActor[*].inputTokens / outputTokens / costUsd / totalTokens: 0` ✗ all
- `byModel[*].inputTokens / outputTokens / costUsd / totalTokens: 0` ✗ all
- per-turn: `inputTokens / outputTokens / costUsd` are correctly `null`,
  but `totalTokens` is still `0` (the derived field hasn't been
  taught to be `null` when its parts are `null`)

T7-S2 fixed the `usage-summary-builder.ts` but did NOT propagate
through `runPaseo`'s aggregation that constructs `byActor` /
`byModel` rollups, and didn't fix `totalTokens` in the per-turn
shape.

## What works (do NOT regress)

Everything else: T7-S1 craft fidelity, T7-S3 disconnect classification,
the orchestration loop, smoke-live acceptance gate, all bridge
self-check + role-anchor work.

## Slice T8-S1 — Null aggregate totals end-to-end

**Goal:** when usage data is `unavailable` for a turn, EVERY rollup
that includes that turn must propagate `null` instead of `0`. When
status is `available` and an actual `0` was observed (e.g. zero
tokens reported), `0` is preserved.

**Specifically:**
1. **runPaseo aggregation** (`run-paseo.ts`): the construction of
   `byActor` and `byModel` summaries when computing `UsageSummary`
   needs to preserve `null` for unavailable fields. Trace: where
   does `byActor` get built? It's likely in the `usage` accumulator
   added in T6-S6. Update that accumulator to use `null` accumulation
   semantics: a + null = null; sum across all-null entries = null;
   sum across mixed = sum of available.
2. **per-turn `totalTokens`** field: when `inputTokens === null` OR
   `outputTokens === null`, `totalTokens` should also be `null`.
   Current code computes `inputTokens + outputTokens` which on null
   inputs yields `NaN` or `0` depending on coercion. Fix to be
   explicit `null`-aware.
3. **`byActor` totals**: same null-aware aggregation.
4. **`byModel` totals**: same.
5. **Top-level totals**: T7-S2 fixed these via builder; verify the
   builder is actually called rather than runtime constructing
   them ahead of the builder.

**Deliverables:**
- Modify `packages/pluto-v2-runtime/src/adapters/paseo/run-paseo.ts`
  the `createUsageAccumulator()` (or equivalent helper).
- Modify `packages/pluto-v2-runtime/src/evidence/usage-summary-builder.ts`
  to ensure `totalTokens` per-turn / per-actor / per-model is null-aware.
- Tests: assert `usage-summary.json` for `unavailable` status has
  `null` (not `0`) at all aggregate levels.
- Re-run the smoke-acceptance regression on the POST-T6 fixture
  (which is `unavailable`) to confirm shape.

**Cost:** ~150-300 LOC, 2-4 files.

## Risk register

1. Schema change from `number` to `number | null` for byActor/byModel
   rollup fields may break downstream consumers. Mitigation: same
   pattern T7-S2 used for top-level — type widening only.
2. Existing tests asserting `0` for unavailable rollups must be
   updated. Mitigation: search-and-update; should be small (≤5).

## Stop conditions

1. Schema change requires v2-core types → STOP.
2. The paseo runtime constructs totals in a path that bypasses the
   builder entirely → STOP, redesign the boundary.
