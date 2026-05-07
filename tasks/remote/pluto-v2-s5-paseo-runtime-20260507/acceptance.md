# Acceptance bar — pluto-v2-s5-paseo-runtime-20260507

This file restates the binding acceptance items from the canonical plan
section "S5 — Phase 5" of `docs/plans/active/v2-rewrite.md` (HEAD on
`main` `c286d96`). On conflict, the plan wins. Local manager will
re-verify each row before merge.

## Binding tables / specs (verbatim from plan)

### A. PaseoCliClient closed surface (deliverable 1)

```ts
export interface PaseoAgentSpec {
  readonly provider: string;       // e.g. 'opencode'
  readonly model: string;          // e.g. 'openai/gpt-5.4-mini'
  readonly mode: string;           // e.g. 'build'
  readonly thinking?: string;      // e.g. 'high'
  readonly title: string;
  readonly initialPrompt: string;  // positional <prompt> arg for `paseo run`;
                                   // becomes the first user turn for the actor
  readonly labels?: ReadonlyArray<`${string}=${string}`>;  // paseo CLI rejects bare ids
  readonly cwd?: string;            // sandbox-side path when --host targets a remote daemon
}

export interface PaseoAgentSession { readonly agentId: string; }

export interface PaseoLogsResult {
  readonly transcriptText: string;
  readonly waitExitCode: number;
}

export interface PaseoUsageEstimate {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
}

export interface PaseoCliClient {
  spawnAgent(spec: PaseoAgentSpec): Promise<PaseoAgentSession>;
  sendPrompt(agentId: string, prompt: string): Promise<void>;
  waitIdle(agentId: string, timeoutSec: number): Promise<{ exitCode: number }>;
  readTranscript(agentId: string, tailLines: number): Promise<string>;
  usageEstimate(agentId: string): Promise<PaseoUsageEstimate>;
  deleteAgent(agentId: string): Promise<void>;  // best-effort
}

export function makePaseoCliClient(deps: {
  bin?: string;                  // default 'paseo'
  host?: string;                 // optional --host
  cwd: string;                   // working dir for spawned processes
  processSpawn?: typeof spawn;   // injectable for tests
  timeoutDefaultSec?: number;    // default 60
}): PaseoCliClient;
```

`PaseoCliClient` is the **ONLY** file under
`packages/pluto-v2-runtime/src/**` allowed to import
`node:child_process`. Long prompts go through a temp file via
`paseo send --no-wait --prompt-file <path>`. `waitIdle` returns
exit code WITHOUT throwing on non-zero. `deleteAgent` swallows
failures.

### B. PaseoRuntimeAdapter sub-interface (deliverable 2)

```ts
import type { RuntimeAdapter, KernelView } from '../../runtime/runtime-adapter.js';
import type { ActorRef } from '@pluto/v2-core';

export interface PaseoTurnRequest {
  readonly actor: ActorRef;
  readonly prompt: string;
}

export interface PaseoTurnResponse {
  readonly actor: ActorRef;
  readonly transcriptText: string;
  readonly usage: PaseoUsageEstimate;
}

export interface PaseoRuntimeAdapter<S> extends RuntimeAdapter<S> {
  pendingPaseoTurn(state: S, view: KernelView): PaseoTurnRequest | null;
  withPaseoResponse(state: S, response: PaseoTurnResponse): S;
}
```

`PaseoAdapterState` MUST include `turnIndex`, `maxTurns`,
`currentActor`, `transcriptByActor`, `awaitingResponseFor`,
`bufferedResponse`, `parseFailureCount`, `maxParseFailuresPerTurn`
(default 2).

`step` behavior is binding:
- If `bufferedResponse !== null`: parse via `PaseoDirectiveSchema`,
  emit corresponding `ProtocolRequest`.
- If parse fails AND `parseFailureCount > maxParseFailuresPerTurn`:
  return `{ kind: 'done', completion: { status: 'failed', summary:
  'parse failure budget exhausted for actor X at turn Y' }, nextState }`.
- If `turnIndex >= maxTurns`: return `{ kind: 'done', completion:
  { status: 'failed', summary: 'maxTurns exhausted' }, nextState }`.
- Reaching `step` with `bufferedResponse === null && pendingPaseoTurn
  !== null` is a bug → throw `PaseoAdapterStateError`.

### C. runPaseo algorithm (deliverable 3)

```ts
export async function runPaseo<S>(
  authored: AuthoredSpec,
  adapter: PaseoRuntimeAdapter<S>,
  options: {
    client: PaseoCliClient;
    idProvider: IdProvider;
    clockProvider: ClockProvider;
    paseoAgentSpec: (actor: ActorRef) => PaseoAgentSpec;
    correlationId?: string | null;
    maxSteps?: number;          // default 1000; counts STEP phases ONLY
    waitTimeoutSec?: number;    // default 600
  },
): Promise<{
  events: ReadonlyArray<RunEvent>;
  views: ProjectionViews;
  evidencePacket: EvidencePacket;
  usage: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    byActor: ReadonlyMap<string, {
      turns: number; inputTokens: number; outputTokens: number; costUsd: number;
    }>;
    perTurn: ReadonlyArray<{
      turnIndex: number; actor: ActorRef;
      inputTokens: number; outputTokens: number; costUsd: number;
      waitExitCode: number;
    }>;
  };
}>;
```

Algorithm pseudocode (verbatim binding):

```text
1. teamContext = compileTeamContext(authored)
2. kernel = new RunKernel({ initialState: initialState(teamContext),
                            idProvider, clockProvider })
3. kernel.seedRunStarted({ scenarioRef, runProfileRef,
                           startedAt: clockProvider.nowIso() })
4. let s = adapter.init(teamContext, kernelViewOf(kernel))
5. const agentByActorKey = new Map<string, string>()
   const usage = empty accumulator
   let stepCount = 0
6. loop indefinitely:
     // model phase (does NOT consume stepCount)
     const turn = adapter.pendingPaseoTurn(s, kernelViewOf(kernel))
     if turn !== null:
       const actorKey = actorKeyOf(turn.actor)
       let agentId = agentByActorKey.get(actorKey)
       if agentId === undefined:
         const session = await client.spawnAgent(
           options.paseoAgentSpec(turn.actor))
         agentId = session.agentId
         agentByActorKey.set(actorKey, agentId)
       const lastSeenLen = transcriptLengthBefore(s, turn.actor)
       await client.sendPrompt(agentId, turn.prompt)
       const wait = await client.waitIdle(agentId, options.waitTimeoutSec)
       const fullText = await client.readTranscript(agentId, 200)
       const newSlice = fullText.slice(lastSeenLen)
       const usageEst = await client.usageEstimate(agentId)
       usage.accumulate({ turn: s.turnIndex, actor: turn.actor,
                          waitExitCode: wait.exitCode, ...usageEst })
       s = adapter.withPaseoResponse(s, {
         actor: turn.actor, transcriptText: newSlice, usage: usageEst
       })
       continue   // re-check pendingPaseoTurn before stepping
     // step phase (consumes stepCount)
     if stepCount >= (options.maxSteps ?? 1000):
       throw new RunNotCompletedError('maxSteps exceeded')
     stepCount += 1
     const step = adapter.step(s, kernelViewOf(kernel))
     if step.kind === 'done':
       kernel.submit({
         requestId: idProvider.next(),
         runId: kernel.state.runId,
         schemaVersion: SCHEMA_VERSION,
         actor: { kind: 'manager' },
         intent: 'complete_run',
         payload: step.completion,
         idempotencyKey: null,
       }, { correlationId: options.correlationId ?? null })
       s = step.nextState
       break
     kernel.submit(step.request, { correlationId: options.correlationId ?? null })
     s = step.nextState
7. for [, agentId] of agentByActorKey: await client.deleteAgent(agentId)
8. const events = stripAcceptedRequestKey(
     kernel.eventLog.read(0, kernel.eventLog.head + 1))
9. const views = replayAll(events)
   const evidencePacket = assembleEvidencePacket(views, events,
                                                  kernel.state.runId)
   return { events, views, evidencePacket, usage: usage.finalize() }
```

Key invariants:
- Model phase does NOT consume `maxSteps`.
- Adapter owns `maxTurns`; surfaces exhaustion as `done.failed`.
- Events match `runScenario`'s public event shape (no
  `acceptedRequestKey`).
- Best-effort cleanup via `deleteAgent`.

### D. PaseoDirectiveSchema (deliverable 4)

```ts
import {
  MailboxMessageAppendedPayloadSchema,
  TaskCreatedPayloadSchema,
  TaskStateChangedPayloadSchema,
  ArtifactPublishedPayloadSchema,
  RunCompletedPayloadSchema,
} from '@pluto/v2-core';

export const PaseoDirectiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('append_mailbox_message'),
             payload: MailboxMessageAppendedPayloadSchema.omit({ messageId: true }) }),
  z.object({ kind: z.literal('create_task'),
             payload: TaskCreatedPayloadSchema.omit({ taskId: true }) }),
  z.object({ kind: z.literal('change_task_state'),
             payload: TaskStateChangedPayloadSchema.omit({ from: true }) }),
  z.object({ kind: z.literal('publish_artifact'),
             payload: ArtifactPublishedPayloadSchema.omit({ artifactId: true }) }),
  z.object({ kind: z.literal('complete_run'),
             payload: RunCompletedPayloadSchema.omit({ completedAt: true }) }),
]);
```

`extractDirective(text)` searches for fenced ```json``` block first,
then first balanced JSON object. Returns
`{ ok: false, reason }` on failure.

### E. mock-script.json schema (deliverable 6)

```ts
type MockScriptEntry = {
  turnIndex: number;
  actor: ActorRef;
  transcriptText: string;        // includes fenced ```json``` block matching PaseoDirectiveSchema
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  waitExitCode: number;          // 0 for success
};
type MockScript = ReadonlyArray<MockScriptEntry>;
```

Mock client behavior:
- `spawnAgent` returns `agentId = 'mock-' + actorKey(actor)`.
- `sendPrompt` no-op.
- `waitIdle` returns `{ exitCode: scripted.waitExitCode }`.
- `readTranscript` returns cumulative text for the actor's prior +
  current turn.
- `usageEstimate` returns scripted usage.

Mapping to `expected-events.jsonl` is mechanical: each scripted
directive becomes one v2 ProtocolRequest, which becomes one v2
RunEvent via the kernel's `submit` path.

### F. Live-smoke acceptance bounds (deliverable 6)

- Total turns ≤ 20.
- Total cost ≤ $0.50 USD.
- Run reaches `run_completed` (status `succeeded` OR `failed`; must
  NOT throw `RunNotCompletedError`).
- `replayAll(events)` succeeds.
- `assembleEvidencePacket` produces a packet that parses through
  `EvidencePacketShape`.
- Captured artifacts under `tests/fixtures/live-smoke/<newRunId>/`:
  - `events.jsonl`
  - `evidence-packet.json`
  - `final-report.md`
  - `usage-summary.json`
  - `paseo-transcripts/<actorKey>.txt` (raw paseo logs per role)

## Gates

### Gate 1 — Package-scoped typecheck

```bash
pnpm --filter @pluto/v2-core typecheck
pnpm --filter @pluto/v2-runtime typecheck
```

Both clean.

### Gate 2 — Package-scoped vitest

```bash
pnpm --filter @pluto/v2-core test
pnpm --filter @pluto/v2-runtime test
```

Both green. v2-runtime adds **≥ 16 unit tests across 4 new files**
(paseo-cli-client, paseo-directive, paseo-adapter, run-paseo). v2-core
test count UNCHANGED from S4 (≥ 186).

### Gate 3 — Package-scoped build

Both clean.

### Gate 4 — Root regression

`pnpm test` green.

### Gate 5 — Live smoke

```bash
pnpm smoke:live
```

Must:
- Exit 0.
- Produce `tests/fixtures/live-smoke/<newRunId>/{events.jsonl,
  evidence-packet.json, final-report.md, usage-summary.json,
  paseo-transcripts/}`.
- `usage-summary.json` shows total cost ≤ $0.50, total turns ≤ 20.
- `evidence-packet.json` parses through `EvidencePacketShape`.

### Gate 6 — No-runtime-leak grep refinement

```bash
rg -n 'paseo|opencode|claude' packages/pluto-v2-runtime/src \
  --glob '!packages/pluto-v2-runtime/src/adapters/paseo/**' \
  --glob '!packages/pluto-v2-runtime/src/index.ts'
```

Expected: 0 matches. `src/index.ts` is the package's public re-export
surface and legitimately references the paseo adapter modules.

### Gate 7 — No-HTTP grep (production source only)

```bash
rg -n "from 'node:http'|from 'node:https'|fetch\(|require\('node:http'\)|require\('node:https'\)" \
  packages/pluto-v2-runtime/src
```

Expected: 0 matches. Test directories are NOT scoped.

### Gate 8 — No-process-spawn-outside-cli-client grep

```bash
rg -n "from 'node:child_process'|require\('node:child_process'\)" \
  packages/pluto-v2-runtime/src \
  --glob '!packages/pluto-v2-runtime/src/adapters/paseo/paseo-cli-client.ts'
```

Expected: 0 matches.

### Gate 9 — No ambient randomness/time

```bash
rg -n 'crypto\.randomUUID|Math\.random|Date\.now|new Date\(|performance\.now' \
  packages/pluto-v2-runtime/src
```

Expected: 0 matches (everything goes through injected providers).

### Gate 10 — No S2/S3/S4 mutation

```bash
git diff --stat main..origin/<branch> -- \
  packages/pluto-v2-core/ \
  packages/pluto-v2-runtime/src/runtime/ \
  packages/pluto-v2-runtime/src/loader/ \
  packages/pluto-v2-runtime/src/evidence/ \
  packages/pluto-v2-runtime/src/legacy/ \
  packages/pluto-v2-runtime/src/adapters/fake/
```

Expected: zero changes.

### Gate 11 — Diff hygiene

`git diff --name-only main..origin/<branch>` MUST be a subset of:

- `packages/pluto-v2-runtime/src/adapters/paseo/**`
- `packages/pluto-v2-runtime/__tests__/adapters/paseo/**`
- `packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/**`
- `tests/fixtures/live-smoke/<newRunId>/**`
- `packages/pluto-v2-runtime/src/index.ts` (additive re-exports)
- `package.json` (additive `smoke:live` script if missing)
- `pnpm-lock.yaml` (only if root `package.json` changes)
- `docs/design-docs/v2-paseo-adapter.md` (new)

NO edits to: v1.6 `src/`, `tests/`, `evals/`, `docker/`, `playbooks/`,
`scenarios/`, `run-profiles/`, `agents/`; ANY file under
`packages/pluto-v2-core/`; ANY file under
`packages/pluto-v2-runtime/src/{runtime,loader,evidence,legacy,adapters/fake}/`;
`docs/plans/active/v2-rewrite.md` (S5 status row updated by local
manager post-merge).

### Gate 12 — Branch is committed AND pushed (S5 binding)

`commands.sh verify_pushed_state` prints `OK: pushed state verified`.
Working tree clean.

**S5 binding:** `commit_and_push` runs ONLY after `smoke:live` exits
0 AND the live-smoke fixture artifacts exist on disk. If `smoke:live`
fails (exit code non-zero, missing artifacts, or bounds exceeded),
the slice is BLOCKED — do NOT commit a partial fixture.

### Gate 13 — Reviewer sub-agent confirms

A remote OpenCode reviewer leaf reads `git diff
main..origin/<branch>` AND a sample of new files, and confirms:

a. `PaseoRuntimeAdapter` matches table B byte-for-byte (sync surface
   at the base interface, additive sub-interface for the two paseo
   methods).
b. `PaseoCliClient` is the only `child_process` user (gate 8).
c. `runPaseo` does NOT modify S4 `runScenario` or the kernel; events
   match `runScenario`'s public event shape (no `acceptedRequestKey`).
d. Live-smoke fixture is well-formed and within bounds (gate 5).
e. No S2/S3/S4 surface mutations (gate 10).
f. Per-turn / per-actor / per-model usage diagnostics are emitted
   in `usage-summary.json`.

## Stop conditions for the remote root manager

- Paseo CLI not present on the sandbox or fails any subcommand probe
  (`paseo --version`, `paseo run --help`, `paseo send --help`,
  `paseo wait --help`, `paseo logs --help`) — STOP and report BLOCKED.
- The S4 `RuntimeAdapter` interface forces semantics that the Paseo
  sub-interface cannot satisfy without S4 mutation — STOP and report
  BLOCKED.
- Live smoke exhausts cost budget ($0.50) before reaching
  `run_completed` — STOP and report BLOCKED with the partial usage
  summary.
- Live smoke reaches `maxTurns` without `complete_run` — STOP and
  report BLOCKED with the captured fixture (it still parses, just
  marked `status: 'failed'`).
- Push fails (auth) — STOP and report BLOCKED with the local SHA.
  Local manager will pull `diff.patch`.
- Sandbox unhealthy — STOP and report BLOCKED.
