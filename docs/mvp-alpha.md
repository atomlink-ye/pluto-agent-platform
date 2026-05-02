# Pluto MVP-alpha — Object & Contract Reference

## Goal

Prove the smallest closed loop where Pluto loads authored `Agent`, `Playbook`,
`Scenario`, and `RunProfile`, runs the v1.6 mailbox/task-list runtime, and emits
audit-grade evidence.

## Mainline runtime

- Entrypoint: `src/orchestrator/manager-run-harness.ts`
- CLI: `src/cli/run.ts` (`pnpm pluto:run ...`)
- Main evidence: `.pluto/runs/<runId>/evidence-packet.{md,json}`
- Runtime primitives: mailbox, task list, hooks, plan approval

## Objects

| Object | Where it lives | Notes |
| --- | --- | --- |
| `Agent` | `agents/*.yaml` | authored role/system/model definition |
| `Playbook` | `playbooks/*.yaml` | team composition + workflow + audit policy |
| `Scenario` | `scenarios/*.yaml` | task specialization and overlays |
| `RunProfile` | `run-profiles/*.yaml` | workspace + acceptance + artifact/stdout policy |
| `MailboxMessage` | `mailbox.jsonl` / `src/contracts/four-layer.ts` | typed coordination message |
| `Task` | `tasks.json` / `src/contracts/four-layer.ts` | shared task-list record |
| `Run` | `.pluto/runs/<runId>/` | materialized runtime record |
| `EvidencePacket` | `.pluto/runs/<runId>/evidence-packet.{md,json}` | canonical evidence |

## Adapter contract

`PaseoTeamAdapter` remains the only runtime seam. It bootstraps the run, creates the lead
session, creates worker sessions when asked by the harness/runtime flow, forwards
messages, drains events, waits for completion, and tears down runtime state.

## Runtime evidence

Required runtime artifacts:

- `mailbox.jsonl`
- `tasks.json`
- `artifact.md`
- `evidence-packet.json`

## Acceptance

A run is acceptable iff:

1. mailbox/task artifacts exist and reflect the expected task progression;
2. the final artifact exists and references the contributing roles;
3. `evidence-packet.json` exists and records citations plus mailbox/task lineage.
