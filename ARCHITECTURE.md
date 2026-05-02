# ARCHITECTURE.md — Pluto MVP-alpha Architecture

## Module Responsibilities

| Module | Responsibility | Owns |
|--------|---------------|------|
| `src/contracts/four-layer.ts` | authored/runtime schema | Agent, Playbook, Scenario, RunProfile, Run, EvidencePacket, MailboxMessage, Task |
| `src/contracts/adapter.ts` | adapter interface | `PaseoTeamAdapter` seam |
| `src/four-layer/` | mailbox/tasks/hooks/plan approval + render/load/audit | file-backed runtime primitives |
| `src/orchestrator/manager-run-harness.ts` | main runtime orchestration | run lifecycle, evidence integration |
| `src/adapters/fake/` | deterministic adapter | in-memory mailbox/task runtime |
| `src/adapters/paseo-opencode/` | live adapter | paseo chat transport + OpenCode launch |
| `docker/live-smoke.ts` | live E2E | smoke assertions |

## Control Flow

```text
pnpm pluto:run
  -> load four-layer YAML
  -> render prompts
  -> create mailbox.jsonl + tasks.json
  -> launch lead via adapter
  -> coordinate teammates through mailbox/task runtime
  -> run hooks + acceptance
  -> write artifact + evidence packet
```

## Runtime Evidence Surfaces

- `.pluto/runs/<runId>/mailbox.jsonl`
- `.pluto/runs/<runId>/tasks.json`
- `.pluto/runs/<runId>/artifact.md`
- `.pluto/runs/<runId>/evidence-packet.{md,json}`

## Adapter Boundary

The adapter is the only seam to runtime-specific behavior. Provider IDs, model names,
CLI flags, and transport quirks stay inside adapter implementations.
