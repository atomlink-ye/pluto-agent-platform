# Plan: Team-lead-owned orchestration v1.5

## Status

Status: Active

## Goal

Replace the shipped v1 lead-intent compatibility bridge mainline with the canonical
team-lead-owned orchestration path while keeping the bridge and legacy marker lanes as
quarantined fallbacks.

## Scope

1. Rework `src/orchestrator/manager-run-harness.ts` to observe real lead-driven stage
   activity, stop blocking on intent collection, and stop synthesizing the final report.
2. Rework `src/four-layer/render.ts`, `src/four-layer/audit-middleware.ts`,
   `src/contracts/four-layer.ts`, `src/four-layer/loader.ts`, and
   `src/adapters/paseo-opencode/paseo-opencode-adapter.ts` for the v1.5 contract.
3. Update authored run profiles, tests, and repo/design docs to match the canonical
   team-lead-owned runtime and live-smoke acceptance bar.

## Leaf plan

1. L-alpha: harness + render rework
2. L-beta: audit + adapter + schema/run-profile rework
3. L-gamma: tests + docs + completed plan record

## Verification target

- Baseline preflight green on `bcbffb1`
- `pnpm typecheck`
- `pnpm test --reporter dot`
- `pnpm build`
- `pnpm smoke:fake`
- `pnpm verify`
- `pnpm pluto:run --scenario hello-team --run-profile live-team-lead-owned --adapter paseo-opencode`
- `pnpm pluto:run --scenario add-greeting-fn --run-profile live-team-lead-owned --adapter paseo-opencode`

## Notes

- Canonical viability is already proven by `tasks/remote/team-lead-owned-orchestration-v1_5/evidence-lead-2a10fbd6.txt`.
- The root manager owns decomposition, integration, live acceptance, and final artifacts.
- All concrete code, test, and product-doc edits are delegated to OpenCode companion leaves.
