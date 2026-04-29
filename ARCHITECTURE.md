# ARCHITECTURE.md — Pluto MVP-alpha Architecture

## Module Responsibilities

| Module | Responsibility | Owns |
|--------|---------------|------|
| `src/contracts/adapter.ts` | Adapter interface | `PaseoTeamAdapter` seam |
| `src/orchestrator/` | Team run lifecycle | Events, artifact, state machine |
| `src/adapters/fake/` | In-process adapter | Deterministic test runtime |
| `src/adapters/paseo-opencode/` | Live adapter | Paseo CLI + OpenCode |
| `docker/live-smoke.ts` | Live E2E | Host-driven smoke |
| `scripts/verify.mjs` | Fast gates | typecheck→test→build→smoke:fake→blocker |

## Dependency Direction

```
src/contracts/     ← orchestrator/ ← adapters/
                    ↑                 ↑
                 scripts/          docker/
```

The orchestrator imports the adapter interface, never implementations. Adapters are injected via factory.

## Control Flow

```
User: pnpm submit → TeamRunService.run()
                     ↓
               adapter.startRun()
               adapter.createLeadSession()
                     ↓
               Team Lead via Paseo/OpenCode
                     ↓
               adapter.createWorkerSession() × N
                     ↓
               adapter.waitForCompletion()
                     ↓
               orchestrator writes artifact.md
```

## Data Flow

- **Input:** TeamTask (title, prompt, workspace, minWorkers)
- **Events:** `.pluto/runs/<runId>/events.jsonl` (append-only)
- **Output:** `.pluto/runs/<runId>/artifact.md` (Team Lead markdown)

## Adapter Boundary

The adapter is the only seam to runtime:

```typescript
interface PaseoTeamAdapter {
  startRun(input: { runId, task, team }): Promise<void>
  createLeadSession(input: { runId, task, role }): Promise<AgentSession>
  createWorkerSession(input: { runId, role, instructions }): Promise<AgentSession>
  sendMessage(input: { runId, sessionId, message }): Promise<void>
  readEvents(input: { runId }): Promise<AgentEvent[]>
  waitForCompletion(input: { runId, timeoutMs }): Promise<AgentEvent[]>
  endRun(input: { runId }): Promise<void>
}
```

All runtime-specific concepts (Paseo agent IDs, OpenCode handles, model names) live inside adapter `external` payloads.

## Runtime State

- **.pluto/runs/** — gitignored, per-run state
- **.paseo-pluto-mvp/** — gitignored, Paseo daemon state

## MVP Invariants

1. At least 2 workers must complete per run.
2. Events must follow canonical lifecycle: `run_started → lead_started → worker_* → lead_message → artifact_created → run_completed`.
3. Artifact must not leak protocol fragments (`TEAM LEAD ASSIGNMENT`, `WORKER ASSIGNMENT`, `[User]`, `[Thought]`, `[Tool]`, `# System`, `Instructions from the Team Lead`, `Reply with your contribution only`).
4. No-endpoint blocker exits with code 2 if OPENCODE_BASE_URL unset.
5. Free model is `opencode/minimax-m2.5-free`.