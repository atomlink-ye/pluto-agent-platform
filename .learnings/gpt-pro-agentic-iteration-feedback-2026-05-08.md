# GPT Pro feedback on Pluto v2 agentic-team gap (2026-05-08)

External independent analysis received from operator. Treat as a
ground-truth peer review of the v2 rewrite + the agentic gap.

## Headline judgment

> Pluto v2 rewrite 成功了；Pluto agent-team product 还没成功.
>
> v2 已经把"可审计外骨骼"造好；下一阶段要把"agentic team
> muscles"接上.

Score:
- 架构整改: 8/8 (S1–S7 done — confirmed)
- agent-team 产品可用性: ~4.5–5/8
- 距离 Claude Code Agent Teams: 还有一整个下一阶段

## 7 缺口 (binding for next iteration)

### A. Spec 没有"用户任务 / work contract"

Current AuthoredSpecSchema has `runId / scenarioRef / runProfileRef
/ actors / declaredActors / initialTasks? / fakeScript? / policy?`.

Missing: user goal, artifact contract, acceptance/audit rule, team
roles, runtime config. So `pluto:run --spec` is "execute a v2
harness spec," not "let agent team complete a user task."

Minimum spec extension:
```yaml
runId: ...
scenario:
  goal: "Implement feature X"
  context: [...]
  expectedArtifact:
    path: ...
    sections: ...
acceptance:
  commands:
    - argv: ["pnpm", "test"]
team:
  lead: manager
  members: [planner, generator, evaluator]
```

### B. Team lead 没有看 state 做决策

`paseo-adapter.ts:117-176` `phasePlan()` is hardcoded; every prompt
verbatim contains the directive JSON ("Return exactly one fenced
JSON code block ... must match exactly: {...}").

Target loop:
```
state snapshot:
  tasks / mailbox / artifacts / pending roles /
  allowed actions / last rejection / result
manager returns one directive:
  create_task | append_mailbox_message | publish_artifact |
  complete_run | spawn_request | ...
```

### C. 协议层缺 Agent Team message kinds

Current ProtocolRequest intents: 5 primitives
(`append_mailbox_message`, `create_task`, `change_task_state`,
`publish_artifact`, `complete_run`). Right size for kernel
minimal closed set, but insufficient for Agent Teams semantics.

**Two-layer architecture (KEY recommendation):**
```
TeamProtocolEnvelope (agent-facing collaboration language)
  -> translated into ProtocolRequest(s)
  -> RunKernel validates
  -> RunEvent(s)
```

First-class envelope kinds (per design docs):
- `spawn_request`
- `worker_complete`
- `evaluator_verdict`
- `revision_request`
- `final_reconciliation`

Translation example:
```
worker_complete envelope
  -> mailbox_message_appended
  -> task_state_changed(completed)
  -> roleCitation candidate
```

Don't add envelope kinds as RunEvent kinds — keep the kernel closed
set narrow; add a translator layer.

### D. Evidence 不够 audit-grade

Current EvidencePacket: status / summary / startedAt / completedAt
/ citations / tasks / mailboxMessages / artifacts.

Design requires additionally: command results, task transitions,
mailbox transcript, RoleCitation, WorkerComplete, EvaluatorVerdict,
FinalReconciliation, AcceptanceResult, AuditResult, RuntimeLineage,
FailureReason.

Current citations only have run_started + run_completed kinds. Far
from "prove every role did what they claim and why it's
trustworthy."

### E. pluto:run 主路径没写完整 run directory

`smoke-live.ts` writes the full fixture (events.jsonl,
evidence-packet.json, final-report.md, usage-summary.json,
paseo-transcripts/*.txt). But `src/cli/v2-cli-bridge.ts` regular
`pluto:run --spec` only writes evidence-packet.json + transcripts.
**Counter-intuitive: smoke-live emits more than the production
CLI.**

Required fix:
```
.pluto/runs/<runId>/
  events.jsonl
  projections/
    tasks.json
    mailbox.jsonl
  evidence-packet.json
  final-report.md
  usage-summary.json
  paseo-transcripts/
```

Otherwise "RunEventLog is source of truth" doesn't hold at the
product output layer.

### F. usage accounting 是假的

Live-smoke `usage-summary.json` shows `tokens=0, cost=$0` despite
real LLM responses in transcripts. `PaseoCliClient.usageEstimate()`
not wired to OpenCode/provider extraction.

Short-term fix:
```json
{
  "usageStatus": "unavailable",
  "reportedBy": "paseo-inspect",
  "estimated": false
}
```

Don't let `$0` masquerade as real cost — affects budget control,
audit, multi-agent run safety.

### G. v2-runtime README 漂移

`packages/pluto-v2-runtime/README.md` still says "fake-runtime
only" + "live Paseo-backed runtime adapter is deferred to S5", but
src/index.ts already exports `makePaseoAdapter` /
`makePaseoCliClient` / `PaseoDirectiveSchema` / `runPaseo`. Small
but misleading post-S7.

## 5-slice decomposition (binding order)

### N1 — 真实用户任务输入 + full run directory

Goal: `pluto:run --spec` no longer just a smoke runner.

Deliverables:
- AuthoredSpec.task.goal
- AuthoredSpec.artifactContract
- AuthoredSpec.acceptance?
- pluto:run writes events.jsonl + projections + evidence +
  final-report + usage-summary

Acceptance:
- Real goal in
- manager/planner/generator/evaluator runs
- events.jsonl replays
- final-report cites evidence

### N2 — manager-led orchestration loop

Goal: Remove hardcoded `phasePlan()`'s control authority.

Deliverables:
- ManagerDecisionPrompt
- KernelStateSnapshot
- AllowedActionSchema
- manager chooses next directive
- kernel returns accepted/rejected feedback

Acceptance:
- Same task, manager autonomously creates task or selects next
  actor
- **Tests forbid prompt containing the verbatim full-payload
  answer** (grep gate)

### N3 — TeamProtocolEnvelope translator

Goal: Team protocol becomes agent-facing collaboration language.

Deliverables:
- spawn_request
- worker_complete
- evaluator_verdict
- revision_request
- final_reconciliation
- internal translation to existing primitive request/event

Acceptance:
- `worker_complete` creates `mailbox_message_appended` +
  `task_state_changed(completed)` + RoleCitation
- `final_reconciliation` missing citation → `failed_audit`
- Invalid sender → `request_rejected`

### N4 — Mailbox 真通信

Goal: Actor messages affect subsequent prompts, not just evidence.

Deliverables:
- mailbox projection injected into actor prompts
- replyTo / message threading
- manager reads worker/evaluator mailbox before completion

Acceptance:
- generator message changes evaluator prompt
- evaluator verdict changes manager final decision

### N5 — usage / audit hardening

Goal: Don't fake $0 success.

Deliverables:
- usageStatus
- providerUsageRaw
- estimated vs exact
- budget unavailable → warning or fail per runProfile

Acceptance:
- usage unavailable explicitly marked in evidence
- budget gate doesn't treat unknown as $0

## How to apply this in the next iteration

- Treat A–G as the binding gap list; their fix order is N1 → N5.
- Two-layer protocol envelope is THE key architectural decision —
  do not bypass.
- Each slice's grep gate must exclude verbatim-payload prompts (N2
  is the bright line).
- Operator's binding rules from prior memory still apply: aggressive
  v2 replacement; remote-first implementation; OpenCode Companion
  for fixes; reuse review sessions.
