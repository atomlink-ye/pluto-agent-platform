# Plan: Four-layer contract stub freeze

## Status

Status: Completed

## Goal

Freeze the initial runtime-neutral TypeScript contract surface for authored `Agent`, `Playbook`, `Scenario`, and `RunProfile`, plus canonical `Run` and `EvidencePacket` records, before broader playbook-first implementation fan-out.

## Completed scope

- Extended `src/contracts/four-layer.ts` so canonical evidence packets can capture command outputs, transitions, artifact refs, citations, and lineage.
- Added `src/four-layer/evidence-packet.ts` for canonical evidence aggregation and persisted `evidence-packet.{md,json}` outputs.
- Added `src/orchestrator/manager-run-harness.ts` as the mainline four-layer runtime path, but initially as a compatibility bridge rather than true lead-owned child spawning.
- Added `src/cli/run.ts` and the `pnpm pluto:run` script for scenario/run-profile invocation.
- Added checked-in authored fixtures under `agents/`, `playbooks/`, `scenarios/`, and `run-profiles/` for the default fake-smoke path.
- Migrated `docker/live-smoke.ts` fake-smoke/mainline coverage onto the four-layer manager-run harness while preserving legacy compatibility evidence.
- Updated README, AGENTS.md, docs/harness.md, docs/testing-and-evals.md, docs/qa-checklist.md, and docs/mvp-alpha.md so the repo consistently positions the four-layer harness as the main runtime path and `TeamRunService` as legacy/quarantined, while preserving the note that the shipped harness is still a compatibility bridge.

## Verification evidence

- `"/workspace/playbook-first-impl-v1-root/node_modules/.bin/tsc" -p tsconfig.json --noEmit`
- `"/workspace/playbook-first-impl-v1-root/node_modules/.bin/vitest" run`
- `"/workspace/playbook-first-impl-v1-root/node_modules/.bin/tsc" -p tsconfig.build.json`
- `PLUTO_LIVE_ADAPTER=fake "/workspace/playbook-first-impl-v1-root/node_modules/.bin/tsx" docker/live-smoke.ts`
- `PATH="/workspace/playbook-first-impl-v1-root/node_modules/.bin:$PATH" node scripts/verify.mjs`

## Remaining follow-up

- Live adapter support is intact through the adapter seam, but the manager-run harness still uses a compatibility-style lead/worker launch flow rather than true TeamLead-owned child spawning.
- Existing `pnpm runs` inspection surfaces still read compatibility `EvidencePacketV0` files; a future iteration can promote canonical four-layer evidence packet inspection to first-class CLI output.
- Additional authored scenarios/run profiles can now land without changing the harness code path.
