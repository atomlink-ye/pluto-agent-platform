# Plan: playbook-first review fix packet

## Status

Status: Completed

## Goal

Resolve the review objections blocking the playbook-first four-layer harness so the shipped runtime and docs no longer overstate canonical lead-owned orchestration support.

## Completed scope

- Changed `src/orchestrator/manager-run-harness.ts` so the harness waits for observed `worker_requested` lead intent before launching workers, executes requests in observed order, runs acceptance commands in the configured workspace, and fails closed on unsupported run-profile policy fields.
- Added a canonical delegation/spawn template to the team-lead-only rendered prompt in `src/four-layer/render.ts`.
- Tightened `src/four-layer/audit-middleware.ts` so final-report role-citation coverage is enforced fail-closed in addition to section/schema checks.
- Updated the fake and Paseo/OpenCode adapters so the mainline path can surface lead delegation intent through adapter events.
- Added regression coverage for lead-intent gating, prompt rendering, final-report role citations, workspace-based acceptance commands, and unsupported run-profile policy handling.
- Aligned `AGENTS.md`, `docs/mvp-alpha.md`, `docs/harness.md`, and the prior completed freeze plan so the repo consistently describes the shipped runtime as a lead-intent compatibility bridge rather than true runtime-owned child spawning.

## Verification evidence

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm smoke:fake`
- `pnpm verify`

## Remaining follow-up

- The shipped mainline still depends on adapter-emitted lead intent plus Pluto-owned mechanical launch; true TeamLead-owned `paseo run --detach --json` recursion remains future work.
- Live `paseo-opencode` intent observation now follows canonical `DELEGATE:` / `SPAWN:` lines, but room-backed STAGE/DEVIATION observation and host-side direct teammate spawning are still not fully delivered.
