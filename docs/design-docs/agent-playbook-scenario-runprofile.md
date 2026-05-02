# Agent / Playbook / Scenario / RunProfile — Canonical Model

Status: **Authoritative** for all product-shape docs (repo `docs/design-docs/`, PM space `04 PRD Specs/`, `05 QA`, repo TS contracts) as of 2026-05-01.

This document supersedes the document-first framing in earlier `core-concepts.md`,
`product-shape.md`, and PM space `Document-first Information Architecture`. Documents,
Versions, Reviews, Approvals, and Publish Packages remain valid downstream governance
objects, but they are **not** the product entry point. The entry point is **Playbook**
and **Run**.

## 1. Product positioning

Pluto is a **playbook-driven, governance-first agent operations platform**. A user
authors a small set of YAML files that describe an AI work team and how it should run;
Pluto renders them into a launch command, observes execution, validates contracted
outputs, and emits an audit-grade evidence packet. Pluto hard-binds to **Paseo** as the
agent runtime for v1; provider/model/runtime concerns live entirely in Paseo's surface,
not in Pluto's product schema.

Pluto's differentiator vs Anthropic Claude Managed Agents: Anthropic provides Agent +
Environment + Session as primitives, with `callable_agents` for one-level multi-agent
delegation. Pluto adds **Playbook** (composition + workflow narrative), **Scenario**
(specialization + knowledge), and **RunProfile** (operational policy: workspace,
worktree, gates, contracts), so an enterprise platform team can stand up a governed,
auditable agent team workflow as configuration rather than as glue code.

## 2. The four layers

Each layer is a separate YAML file. Higher layers reference lower layers by name and
**append content**; no layer ever rewrites a lower layer's content.

### Layer 1 — Agent (`agents/<name>.yaml`)

What the role is, which model it uses, what it's good at. Stable across playbooks.

```yaml
name: planner
description: Decomposes tasks into stage specs with explicit acceptance signals.
model: claude-opus-4-7
system: |-
  You are the planner. For any task, write a single-page spec listing stages,
  acceptance signals, and explicit assumptions. You do not implement.
```

Pluto-specific optional fields (paseo bridging, since v1 hard-binds Paseo):

```yaml
provider: claude/opus[1m]   # paseo provider alias
mode: bypassPermissions     # paseo mode preset
thinking: high              # paseo thinking level
```

### Layer 2 — Playbook (`playbooks/<name>.yaml`)

Which agents form the team, plus a **natural-language workflow** that team_lead reads
to understand the intended flow, plus minimal audit side-data so the lead's behaviour
can be checked without imposing a DAG.

```yaml
name: research-review
description: Plan -> implement -> review with bounded revision loop.
team_lead: teamlead
members: [planner, generator, evaluator]
workflow: |-
  As team lead:
  1. Send task to planner. Read the plan; ask once if unclear.
  2. Hand approved plan to generator.
  3. On generator blocker, route to planner for guidance, return to generator.
  4. On generator self-done, hand artifact + plan to evaluator.
  5. On evaluator fail, send concrete feedback to generator, loop step 4 (max 2).
  6. On evaluator pass, write final summary citing planner, generator, evaluator.
audit:
  required_roles: [planner, generator, evaluator]
  max_revision_cycles: 2
  final_report_sections:
    - workflow_steps_executed
    - deviations
    - required_role_citations
```

`workflow` is prompt text, not a DAG. `audit` provides minimal machine-checkable
discipline: required role citations + revision cap + report section schema.

### Layer 3 — Scenario (`scenarios/<name>.yaml`)

A concrete business context: optional fixed task, per-role prompt overlay, knowledge
references, evaluator rubric. This is the prompt-engineering surface.

```yaml
name: financial-dcf-review
playbook: research-review
task: |-
  Build a 5-year DCF model for Costco in .xlsx, with WACC sensitivity.
task_mode: fixed              # fixed | template
allow_task_override: false
overlays:
  planner:
    prompt: |-
      For DCF tasks, lead with WACC assumptions, terminal-value method,
      and sensitivity dimensions before any modeling.
    knowledge_refs:
      - knowledge/finance/dcf-best-practices.md
  generator:
    knowledge_refs:
      - knowledge/finance/excel-conventions.md
  evaluator:
    rubric_ref: knowledge/finance/dcf-rubric.md
```

`task_mode: fixed` makes the scenario a reproducible benchmark.
`task_mode: template` makes it a reusable specialization with task supplied at runtime.
`knowledge_refs` are loaded by Pluto and concatenated into the role's prompt under a
`## Knowledge` heading. v1 caps: max 3 refs, 8k tokens total, 4k per ref; fail-closed
on overflow.

### Layer 4 — RunProfile (`run-profiles/<name>.yaml`)

Operational policy. Where the run happens, what files must appear, what commands must
pass, what stdout must contain, who must approve. This is **not prompt content**; it is
machine-validated execution policy. Without this layer the audit story collapses into
prose.

```yaml
name: pluto-mvp-alpha
workspace:
  cwd: /Volumes/AgentsWorkspace/.../pluto-agent-platform
  worktree:
    branch: pluto/${run_id}
    path:   ${cwd}/.worktrees/${run_id}
    base_ref: origin/main
required_reads:
  - { kind: feishu, doc: T7rSdMwoZoS4I9xJwUqchmefnhf }
  - { kind: repo, path: AGENTS.md }
acceptance_commands:
  - pnpm typecheck
  - pnpm test
  - pnpm build
  - { cmd: pnpm smoke:fake }
  - { cmd: pnpm smoke:docker, blocker_ok: true }
artifact_contract:
  required_files:
    - .pluto/runs/${run_id}/status.md
    - .pluto/runs/${run_id}/task-tree.md
    - { path: .pluto/runs/${run_id}/final-report.md,
        required_sections: [branch_and_worktree, implementation_summary,
                            key_files, subtask_state, verification_results,
                            blockers, pm_status_updates] }
stdout_contract:
  required_lines:
    - "WROTE: .pluto/runs/${run_id}/<each-required-file>"
    - "SUMMARY: <one-line>"
concurrency:
  max_active_children: 2
approval_gates:
  pre_launch: { enabled: true, prompt: "Confirm launch?" }
secrets:
  redact: true
```

## 3. Render order (Pluto applies at launch)

For each role's system prompt, Pluto stacks in this order:

```
[Agent.system]                          # who I am
↓
## Available Roles                      # team_lead only — auto roster
## Workflow                             # team_lead only — Playbook.workflow
↓
## Specialization                       # Scenario.overlays[role].prompt (if any)
## Knowledge                            # Scenario.overlays[role].knowledge_refs (if any)
## Rubric                               # evaluator only — overlay.rubric_ref (if any)
↓
## Task                                 # Scenario.task or runtime task (last for recency)
```

Operating frame (roles + workflow) precedes domain tuning (specialization +
knowledge). Task is last so recency works. Workflow and roster are injected only into
team_lead; members never see them.

## 4. Audit middleware

Audit is enforced by RunProfile, not by Playbook.workflow. Three observable surfaces
must agree:

1. **Files**: every entry in `RunProfile.artifact_contract.required_files` must exist
   after the run, and any declared `required_sections` must be present in that file.
2. **Stdout**: every regex/line in `RunProfile.stdout_contract.required_lines` must
   appear in the team_lead's stdout.
3. **Workflow/deviation trace**: v1 records adapter-emitted lead delegation intent,
   worker completions, and any explicit `DEVIATION: <reason>` lead output, then
   synthesizes `workflow_steps_executed` / `deviations` report sections from that
   trace. Live `STAGE: <from> -> <to>` / `DEVIATION:` room events remain the target
   model for v1.5+.

Validation is fail-closed: a missing file, missing required section, missing stdout
line, or unsupported/missing workflow evidence marks the run `failed_audit`
regardless of whether the team_lead claims success.

`Playbook.audit.required_roles` enforces final-report citations of those role outputs;
`max_revision_cycles` caps the evaluator→generator loop; `final_report_sections`
determines the section schema for the final report file.

## 5. Runtime — Pluto as harness, team_lead-authored orchestration, shipped via a v1 bridge

Pluto's runtime responsibility is bounded:

1. Load Agent + Playbook + Scenario + RunProfile, validate refs, render team_lead and
    member system prompts according to §3.
2. Fail closed on unsupported runtime policy before materializing workspace state
   (for example pre-launch approval gates, non-repo required reads, unsupported
   concurrency, or authored worktree materialization).
3. Verify `RunProfile.required_reads` are reachable and contained to the declared repo
   root when `kind=repo`.
4. Materialize the workspace/run directory for supported runs.
5. Launch team_lead through the adapter seam (`paseo run --detach --json --provider
   <agent.provider> ...` in the live path), passing the rendered system prompt plus the
   transcript / coordination handle.
6. Wait for adapter-emitted lead delegation intent, then perform the mechanical worker
   launch/spawn fallback in the observed order.
7. Synthesize workflow/deviation evidence from routed worker intent/completions plus
   any explicit lead `DEVIATION:` output; v1 does **not** observe a live
   STAGE/DEVIATION room stream yet.
8. After team_lead exits, run `RunProfile.acceptance_commands` and validate
   `artifact_contract` and `stdout_contract`.
9. Emit `EvidencePacket` aggregating routed transitions, file checkpoints, command
   outputs, synthesized workflow/deviation traces, and final-report citations. Redact
   per `RunProfile.secrets.redact`.

### 5.5 Operational scope for v1 (acceptance target)

- **Shipped v1 runtime:** a lead-intent compatibility bridge. team_lead authors the
  orchestration decisions through Playbook + Scenario prompt context; adapters surface
  those delegation intents to Pluto as `worker_requested` events; Pluto performs the
  mechanical worker launch/spawn fallback.
- **Audit honesty in v1:** workflow/deviation reporting is synthesized from routing
  decisions and explicit lead `DEVIATION:` output. The final report and audit layer must
  describe that synthesis honestly rather than claim a live STAGE/DEVIATION event
  stream.
- **Fallback quarantine:** legacy marker parsing remains a compatibility-only fallback,
  not the accepted mainline model.
- **Canonical aspiration preserved:** true TeamLead-owned child spawning and room-backed
  STAGE/DEVIATION observation remain deferred to v1.5+.

## 6. What this supersedes

| Earlier framing | Status |
|---|---|
| "Document-first" product positioning | Superseded. Documents/Versions/Publish Packages are downstream governance objects, not the product entry point. |
| `TeamPlaybookV0` as stage/DAG/revision data | Superseded. Playbook is composition + workflow narrative + minimal audit side-data. |
| `TeamRunService` as deterministic stage dispatcher | Superseded. Pluto runs a manager-run harness path; TeamRunService is legacy bridge. |
| Pluto-mediated marker bridge (`WORKER_REQUEST: …`) | Narrowed to fallback-only. The shipped mainline is a lead-intent compatibility bridge where adapters surface team_lead delegation intent and Pluto performs the mechanical spawn fallback; true team_lead-owned `paseo run` recursion is deferred. |
| EvidencePacket as run-level only | Extended. Stage-level evidence comes from `artifact_contract.required_files` plus synthesized routing transitions in v1; live STAGE/DEVIATION room capture is deferred. |
| Provider-specific terms in core types (`paseo_chat`, etc.) | Must move into adapter layer; core stays runtime-neutral. |

## 7. Open questions deferred to v1.5+

- Outcome-style independent grader (separate context window from evaluator agent).
- `knowledge_refs` chunking, summarization, and a manifest of omitted refs when caps
  are hit.
- Multi-runtime support (currently hard-bound to Paseo).
- True TeamLead-owned child orchestration via in-agent `paseo run --detach --json`
  recursion plus room-backed STAGE/DEVIATION observation, reducing Pluto to environment
  preparation and evidence observation only. Keep this aligned with the local deferral
  note in `.local/manager/handoff/state.md` and the repo follow-up plan
  `docs/plans/active/teamlead-orchestrated-agent-team-architecture.md`.
- Recursive `callable_agents` (Claude Managed Agents allows only one level; Pluto
  matches that for v1).
- Workflow→RunProfile binding: whether a Playbook can declare a default RunProfile or
  whether they always pair at run invocation.
- Marketplace / catalog distribution of Agents and Playbooks.

## 8. Source of truth & file layout

```
docs/design-docs/agent-playbook-scenario-runprofile.md   # this doc, authoritative
docs/design-docs/index.md                                 # points here
docs/design-docs/core-concepts.md                         # rewritten to match
docs/design-docs/product-shape.md                         # rewritten to match
docs/design-docs/runtime-and-evidence-flow.md             # rewritten to match
src/contracts/                                            # TS types align to §2
agents/                                                   # user-authored Agent YAMLs
playbooks/                                                # user-authored Playbook YAMLs
scenarios/                                                # user-authored Scenario YAMLs
run-profiles/                                             # user-authored RunProfile YAMLs
```

PM space mirror:

```
04 PRD Specs/Playbook-first Information Architecture        # supersedes Document-first IA
04 PRD Specs/Core Object Model                              # rewritten with 4 layers
04 PRD Specs/Portable Workflow Contract                     # exports Playbook + RunProfile
04 PRD Specs/Review & Approval Flow                         # consumes audit middleware
04 PRD Specs/Publish Package Model                          # consumes governance outputs
05 QA                                                       # validates artifact + stdout contracts
```
