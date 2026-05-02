# Plan: Playbook-first implementation v1

## Status

Status: Active

## Source of truth

- `.local/manager/handoff/state.md`
- `.local/manager/handoff/operator-prompt.md`
- `.local/manager/Pluto Iteration Workflow.md`
- `.local/manager/Pluto Remote Orchestration Workflow.md`
- `.local/manager/prepare/Remote Daytona Agent Runtime Playbook.md`
- `docs/design-docs/agent-playbook-scenario-runprofile.md`
- `docs/design-docs/core-concepts.md`
- `docs/design-docs/product-shape.md`
- `docs/design-docs/runtime-and-evidence-flow.md`
- `docs/design-docs/compliance-governance-boundary.md`
- `AGENTS.md`

## Goal

Replace Pluto's TeamRunService-centered orchestration mainline with the canonical playbook-first four-layer runtime.

## Scope

1. Canonicalize contracts around `Agent`, `Playbook`, `Scenario`, `RunProfile`, `Run`, and `EvidencePacket`.
2. Add authored layer loading/validation and prompt rendering.
3. Replace the old dispatcher path with a harness that launches `team_lead`, observes contracted surfaces, and validates post-run outputs.
4. Implement fail-closed audit middleware and canonical EvidencePacket aggregation.
5. Migrate CLI, smoke paths, tests, and docs to the new mainline.

## Execution model

- Local manager: understanding, packaging, remote dispatch, acceptance.
- Remote manager: decomposition, merge control, remote acceptance.
- Remote leaves: all concrete code/test/doc work.

## Acceptance target

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm smoke:fake`
- `pnpm verify`
- `pnpm smoke:live` when available, else structured blocker
- repository/documentation consistency review

## Explicit permission note

This iteration is allowed to replace or retire `TeamRunService` behavior rather than preserve it.

## Completion record (2026-05-02)

- Status: completed (locally accepted)
- Final branch: `pluto/playbook-first-impl-v1`
- Iteration log: `.local/manager/logs/iter-playbook-first-impl-2026-05-01/`
- Tests: 223 files, 718 passed (post-fix-packet)
- Director gates: `pnpm verify` PASS — typecheck, test, build, smoke:fake, no-paseo blocker check
- Stage records (this dir): `four-layer-contract-stub-freeze.md`, `four-layer-loader-render-workstreams-ab.md`, `playbook-first-review-fix.md`, `playbook-first-local-fix-packet.md`
- Authoritative design doc was reconciled in this iteration to bless the v1 lead-intent compatibility bridge as the acceptance target while preserving canonical `team_lead`-owned spawning as a v1.5+ deferred goal (`docs/design-docs/agent-playbook-scenario-runprofile.md`, `docs/design-docs/runtime-and-evidence-flow.md`, `docs/design-docs/core-concepts.md`).
- No git push, PR, Lark/Feishu writeback, or sandbox teardown happened in this round; user decides merge.
