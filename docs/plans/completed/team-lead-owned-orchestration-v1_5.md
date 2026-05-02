# team-lead-owned-orchestration-v1_5 — Completed Plan

## Scope

Reconcile all repo/design docs to the canonical v1.5 team-lead-owned orchestration
model and add additive test coverage that exercises the v1.5 contract without undoing
fallback compatibility.

Task ID: `team-lead-owned-orchestration-v1_5`
Status: integrated

## Implementation Summary

### Doc changes (D1, D2)

All eight target docs updated to make v1.5 team-lead-owned spawning the mainline and
demote both the legacy marker bridge and the v1 lead-intent compatibility bridge to
quarantined fallback lanes:

| File | Change |
|------|--------|
| `docs/design-docs/agent-playbook-scenario-runprofile.md` | §4 audit trace now describes observed STAGE/DEVIATION events; §5 rewritten as "Pluto as harness, team_lead-owned orchestration (v1.5 mainline)" with lead prompt template details and worker discovery; §5.5 now documents both quarantined fallback lanes; §6 supersession table updated; §7 open questions — team-lead-owned orchestration item removed (delivered) |
| `docs/design-docs/runtime-and-evidence-flow.md` | Runtime boundary, harness path, audit contract, legacy bridge section, and Pluto responsibilities all rewritten for v1.5 observation model |
| `docs/design-docs/core-concepts.md` | Coordination Channel and Audit Middleware glossary entries updated |
| `AGENTS.md` | Regression-fix note updated to v1.5 mainline wording |
| `docs/harness.md` | `orchestratorSource` docs updated; CLI surface description updated |
| `docs/mvp-alpha.md` | Mainline orchestration mode, object table, and canonical contract all updated |
| `docs/qa-checklist.md` | Header and doc checklist item updated |
| `docs/testing-and-evals.md` | Mainline test lanes and smoke path updated |

### Code and test changes (H1/H2/R1/A1/AD1/Y1/T1)

- `src/four-layer/render.ts` now renders concrete `paseo run` role templates plus
  STAGE/DEVIATION and worker-coordination guidance instead of the old
  DELEGATE/SPAWN envelope.
- `src/orchestrator/manager-run-harness.ts` removes the 5s intent blocker from the
  active path, records STAGE lines in stdout for audit, keeps fake/legacy
  compatibility green, and preserves v1 bridge helpers as quarantined code.
- `src/four-layer/audit-middleware.ts`, `src/contracts/four-layer.ts`,
  `src/four-layer/loader.ts`, and `src/adapters/paseo-opencode/paseo-opencode-adapter.ts`
  now support the v1.5 runtime knobs and stricter observed-stage audit contract.
- `run-profiles/live-team-lead-owned.yaml` was added for the live acceptance lane.

### Additive test coverage (T1)

New file `tests/team-lead-owned-orchestration.test.ts` with two describe blocks:

1. **Lead prompt contains role roster and workflow**: verifies the team lead's rendered
   prompt includes `## Available Roles` listing all team members, includes `## Workflow`
   (but worker prompts do not), and places `## Task` last in canonical stack order.
2. **Audit enforces observed STAGE transitions for required roles**: verifies audit
   passes when all required roles appear in observed STAGE transitions, fails when a
   required role is missing, fails when no STAGE transitions are observed, and passes
   even with DEVIATION lines present.

### Completed plan (D3)

This file.

## Verification Evidence

- `pnpm typecheck` — pass
- `pnpm test` — pass (`224` files, `734` tests)
- `pnpm build` — pass
- `pnpm smoke:fake` — pass
- `pnpm verify` — pass
- `pnpm vitest run tests/team-lead-owned-orchestration.test.ts` — pass
- `pnpm pluto:run --scenario hello-team --run-profile live-team-lead-owned --adapter paseo-opencode` — pass (`runId 3fde70e3-43a1-4e1c-90b1-a7864f1647f5`)
- `pnpm pluto:run --scenario add-greeting-fn --run-profile live-team-lead-owned --adapter paseo-opencode` — pass (`runId 6988e7d5-94cd-48e8-bb23-993ca01b8852`)

## Follow-ups

1. **Local Claude Code Opus 4.7 lead + OpenCode workers**: deferred to next iteration
   (user's "下一次另外下一次"). Record as
   `docs/plans/active/local-claude-lead-opencode-workers-v1_6.md` placeholder.
2. **Live mainline purity**: the live acceptance lane is green with real paseo agents and
   proof artifacts, but a follow-up review should continue tightening the separation
   between the canonical observation-only path and the quarantined compatibility lane.
