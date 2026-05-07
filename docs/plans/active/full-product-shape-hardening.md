# Plan: Full product shape hardening

> **Status (2026-05-07):** this plan targets the v1.6 runtime / product surface, which is
> now frozen as legacy. The active replacement is
> [`docs/plans/active/v2-rewrite.md`](v2-rewrite.md). Items here should not be re-opened
> against `main` until the v2 acceptance gates land.

## Status

Status: Active

## Source records read

- `.local/manager/handoff/state.md`
- `.local/manager/slice-3-pull/local-acceptance.md`
- `.local/manager/slice-4-pull/local-acceptance.md`
- `.local/manager/slice-5-pull/local-acceptance.md`
- `.local/manager/slice-6-pull/local-acceptance.md`
- `.local/manager/slice-13-pull/local-acceptance.md`
- `.local/manager/slice-7-pull/local-acceptance.md`
- `.local/manager/slice-8-pull/local-acceptance.md`
- `.local/manager/slice-9-pull/local-acceptance.md`
- `.local/manager/slice-10-pull/local-acceptance.md`
- `.local/manager/slice-11-pull/local-acceptance.md`
- `.local/manager/slice-12-pull/local-acceptance.md`
- `/tmp/pluto-iter-final-check-r2-out.md`

## Goal

Turn the accepted PRODUCT_COMPLETE local-file-backed skeleton into a cleaner, maintainable full product shape without changing the accepted scope evidence.

## Scope

- Fix `tests/cli/runs-follow.test.ts` stderr warning so `pnpm verify` is truly green in the local environment.
- Abstract duplicated file-backed stores into a generic `JsonObjectStore<T>`.
- Unify CLI parser/output/error/dataDir utilities across the expanded CLI surface.
- Split `TeamRunService` into clearer runtime selection, budget gate, dispatch loop, retry, and evidence finalization units.
- Shrink `src/index.ts` public API and remove duplicate exports.
- Update README/docs from MVP-alpha language toward the complete product shape now present in local code.
- Add architecture documentation for the local file-backed product skeleton versus future production persistence boundaries.
  - Initial design docs have been added in `docs/design-docs/core-concepts.md`, `docs/design-docs/local-file-backed-architecture.md`, `docs/design-docs/product-shape.md`, `docs/design-docs/runtime-and-evidence-flow.md`, and `docs/design-docs/compliance-governance-boundary.md`.
  - Remaining doc gaps, if needed: future production persistence design, hosted deployment operations, concrete UI navigation specs, and connector-specific operating guides.
- Decide whether `archive/full-product-shape-20260501` should become a PR or be split into smaller mergeable changes.

## Acceptance / verification target

- `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm smoke:fake`, and `pnpm verify` all pass without the known `runs-follow` stderr warning.
- Public API exports are intentional and documented.
- Store and CLI utilities reduce duplication without weakening accepted PRODUCT_COMPLETE behavior.
- Repository-documentation consistency check passes: code/contracts/CLI behavior, docs/plans, design docs, and reference docs do not contradict each other.
- When this hardening is complete, move this record to `docs/plans/completed/` with verification evidence and remaining follow-up.

## Residual / follow-up

- This is follow-up hardening, not a blocker to the completed product verdict recorded in `/tmp/pluto-iter-final-check-r2-out.md`.
