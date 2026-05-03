# Agent / Playbook / Scenario / RunProfile — Canonical Model

Status: **Authoritative** for repo design docs, PM-space mirror framing, and four-layer authored/runtime contracts as of 2026-05-02.

This document supersedes earlier document-first and v1/v1.5 runtime framing. Documents,
Versions, Reviews, Approvals, and Publish Packages remain valid downstream governance
objects, but Pluto's product entry point is **Playbook + Run**.

## 1. Product positioning

Pluto is a **playbook-driven, governance-first agent operations platform**. A user
authors a small set of YAML files that describe an AI work team and how it should run;
Pluto renders them into runtime inputs, validates contracted outputs, and emits an
audit-grade evidence packet.

The v1.6 runtime is **Claude Code Agent Teams aligned**: mailbox + shared task list +
active hooks + plan-approval round-trip, with **paseo chat as mailbox transport** and
Pluto mirroring mailbox/task-list state into run-local files for durable evidence.

## 2. The four layers

Each layer is a separate YAML file. Higher layers reference lower layers by name and
append content; no layer rewrites lower-layer content.

### Layer 1 — Agent (`agents/<name>.yaml`)

What the role is, which model it uses, and how Pluto should launch it.

```yaml
name: planner
description: Decomposes tasks into stage specs with explicit acceptance signals.
model: claude-opus-4-7
system: |-
  You are the planner. For any task, write a single-page spec listing stages,
  acceptance signals, and explicit assumptions. You do not implement.
provider: claude/opus[1m]
mode: bypassPermissions
thinking: high
```

Pluto-specific optional fields stay launch-oriented (`provider`, `mode`, `thinking`).
They are fixture/runtime hints, not workflow-state fields.

### Layer 2 — Playbook (`playbooks/<name>.yaml`)

Which agents form the team, plus the workflow narrative and minimal audit policy.

```yaml
name: research-review
description: Plan -> implement -> review with bounded revision loop.
team_lead: teamlead
members: [planner, generator, evaluator]
workflow: |-
  Coordinate work through task tools and mailbox messages.
  Create tasks in dependency order, review plan-approval requests,
  and finish with a cited FINAL summary.
audit:
  required_roles: [planner, generator, evaluator]
  max_revision_cycles: 2
  final_report_sections:
    - workflow_steps_executed
    - deviations
    - required_role_citations
```

`workflow` is prompt text, not a DAG scheduler. The machine-checkable execution spine in
v1.6 comes from the mailbox/task-list runtime, not from synthetic stdout routing.

### Layer 3 — Scenario (`scenarios/<name>.yaml`)

Business context: optional fixed task, per-role prompt overlay, knowledge references,
and evaluator rubric.

### Layer 4 — RunProfile (`run-profiles/<name>.yaml`)

Operational policy: workspace, required reads, acceptance commands, artifact/stdout
contracts, approval gates, and secret handling.

```yaml
name: fake-smoke
workspace:
  cwd: .tmp/pluto-cli
required_reads:
  - { kind: repo, path: AGENTS.md }
acceptance_commands:
  - pnpm typecheck
  - pnpm test
artifact_contract:
  required_files:
    - artifact.md
stdout_contract:
  required_lines:
    - "RUN_START"
runtime:
  dispatch_mode: orchestrator
```

There is **no runtime-selection field** in the authored schema. v1.6 mailbox/task-list
coordination is the default and only runtime model.

## 3. Render order

For each role's system prompt, Pluto stacks in this order:

```text
[Agent.system]
↓
## Available Roles                  # team_lead only
## Workflow                         # team_lead only
↓
## Specialization
## Knowledge
## Rubric
↓
## Task
```

For the team lead, the runtime-specific coordination block describes:

- task creation through the shared task list
- teammate coordination through mailbox messages / SendMessage semantics
- plan-approval request/response handling
- FINAL summary requirements over completed tasks and mailbox citations

## 4. Audit middleware

Audit is enforced by RunProfile and the mirrored runtime state. Three observable
surfaces must agree:

1. **Files**: required artifacts must exist and contain required sections.
2. **Mailbox/task evidence**: required roles must have completed tasks and teammate-authored
   mailbox messages linking their outputs.
3. **Command results**: acceptance commands and built-in hooks must record pass/fail state.

Validation is fail-closed: missing evidence, missing citations, or missing contracted
artifacts marks the run failed or failed_audit regardless of any success claim in prose.

## 5. Runtime — Pluto as mailbox/task-list harness (v1.6 mainline)

The v1.6 runtime is the canonical execution model.

Pluto's runtime responsibility is bounded but active:

1. Load Agent + Playbook + Scenario + RunProfile, validate refs, and render prompts.
2. Materialize the run workspace plus four-layer runtime state.
3. Create the **file-backed mailbox mirror** (`mailbox.jsonl`) and **shared task list**
   (`tasks.json`).
4. Bind the live adapter so **paseo chat** carries mailbox traffic while Pluto mirrors it
   into the run directory as the durable evidence source.
5. Launch the team lead and teammates with mailbox/task-list references, not per-role
   spawn-command templates.
6. Let the team lead coordinate by creating tasks and sending mailbox messages, with `spawn_request` / `worker_complete` / `final_reconciliation` envelopes driving the default dispatch path.
7. Run active hooks at `TaskCreated`, `TaskCompleted`, and `TeammateIdle`; hook exit 2
   blocks continuation.
8. Execute the plan-approval round-trip through typed mailbox messages
   (`plan_approval_request` / `plan_approval_response`).
9. Run acceptance commands through the built-in completion hook and explicit post-run
   validation.
10. Emit an EvidencePacket whose lineage cites `mailboxLogPath` and `taskListPath`.

### 5.1 Runtime primitives

- **Mailbox**: typed messages, append-only mirror, teammate-local semantics, replayable.
- **Shared task list**: task creation, dependency ordering, assignment/claim state,
  completion state.
- **Hooks**: active control points, not post-hoc linting.
- **Plan approval**: mailbox round-trip between teammate and team lead.
- **Dispatch envelopes**: lead-authored `spawn_request` plus worker/lead completion envelopes that Pluto validates on inbox delivery.

### 5.2 Mailbox transport

Paseo chat is the transport surface. Pluto reads/writes through the adapter, persists the
authoritative mirrored log to the run directory, and does not rely on synthetic routing
or fallback dispatch language. `PLUTO_DISPATCH_MODE=static_loop` remains a temporary compatibility fallback.

## 6. What this supersedes

| Earlier framing | Status |
|---|---|
| Document-first product positioning | Superseded. Documents remain downstream governance objects. |
| `TeamPlaybookV0` stage/DAG runtime as canonical model | Superseded. Playbook stays authored workflow narrative plus audit policy. |
| `TeamRunService` / marker-driven dispatch | Superseded and deleted from the mainline model. |
| v1 lead-intent compatibility bridge | Superseded and deleted. |
| v1.5 underdispatch fallback / synthesized routing | Superseded and deleted. |
| Evidence derived from transcript-routing synthesis | Superseded by mailbox/task-list lineage plus command/file validation. |

## 7. Open questions

- Multi-runtime support beyond paseo.
- Recursive `callable_agents` / nested teams beyond one level.
- Marketplace / catalog distribution of Agents and Playbooks.
- Generic hook/plugin surface beyond the built-in v1.6 hooks.
- Long-lived worker-pool mode and self-claim semantics beyond the current per-task
  materialization model.

## 8. Source of truth & file layout

```text
docs/design-docs/agent-playbook-scenario-runprofile.md   # this doc, authoritative
docs/design-docs/core-concepts.md                         # glossary aligned to v1.6
docs/design-docs/product-shape.md                         # product framing aligned to v1.6
docs/design-docs/runtime-and-evidence-flow.md             # runtime/evidence aligned to v1.6
src/contracts/four-layer.ts                               # authored/runtime schema reference
agents/ playbooks/ scenarios/ run-profiles/               # authored YAML layers
```
