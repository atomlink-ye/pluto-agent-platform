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
3. **Workflow/deviation trace**: the lead emits `STAGE: <from> -> <to>` and
   `DEVIATION: <reason>` lines in its stdout; Pluto observes those directly and
   validates that each `audit.required_roles` entry has a corresponding STAGE
   transition in the lead's text stream.

Validation is fail-closed: a missing file, missing required section, missing stdout
line, or missing STAGE/DEVIATION event marks the run `failed_audit` regardless of
whether the team_lead claims success.

`Playbook.audit.required_roles` enforces final-report citations of those role outputs;
`max_revision_cycles` caps the evaluator→generator loop; `final_report_sections`
determines the section schema for the final report file.

## 5. Runtime — Pluto as harness, team_lead-owned orchestration (v1.5 mainline)

The v1.5 runtime is the canonical team-lead-owned orchestration model. The team_lead
reads its rendered prompt (which includes per-role `paseo run` command templates),
spawns workers directly via `paseo run --detach --json`, and coordinates via `paseo
wait` / `paseo logs`. Pluto materializes the workspace, hands the lead its rendered
prompt, then **observes** — it does not bridge.

Pluto's runtime responsibility is bounded:

1. Load Agent + Playbook + Scenario + RunProfile, validate refs, render team_lead and
    member system prompts according to §3.
2. Fail closed on unsupported runtime policy before materializing workspace state.
3. Verify `RunProfile.required_reads` are reachable and contained to the declared repo
    root when `kind=repo`.
4. Materialize the workspace/run directory for supported runs (but do NOT pre-write
    status/task-tree/artifact files — those are produced by the lead/workers).
5. Launch team_lead through the adapter seam (`paseo run --detach --json --provider
    <agent.provider> ...` in the live path), passing the rendered system prompt plus
    per-role spawn command templates and the transcript / coordination handle.
6. Observe the lead's stdout/transcript for `STAGE: <from> -> <to>` and
    `DEVIATION: <reason>` lines emitted directly by the lead.
7. Discover spawned worker agents via `paseo ls --label parent_run=<runId>`.
8. Capture each spawned worker's logs/output for evidence (via `paseo logs <id>`).
9. Wait for the lead to exit (configurable via `RunProfile.runtime.lead_timeout_seconds`,
    default ≥ 600s).
10. After team_lead exits, run `RunProfile.acceptance_commands` and validate
    `artifact_contract` and `stdout_contract`.
11. Emit `EvidencePacket` aggregating observed STAGE/DEVIATION events, worker
    discovery data, file checkpoints, command outputs, and final-report citations.
    Redact per `RunProfile.secrets.redact`.

### 5.1 Lead prompt (v1.5)

The team_lead's rendered prompt includes, in addition to the canonical stack from §3:

- **Available Roles and Spawn Commands**: for each member role, a concrete
  `paseo run --provider <p> --model <m> --mode <mo> --cwd <cwd> --title <stage-id>
  --label parent_run=<runId> --label role=<roleId> --json --detach "<rendered worker
  prompt>"` template line, so the lead can spawn workers directly.
- **STAGE/DEVIATION emission discipline**: the lead must emit
  `STAGE: <from-stage-id> -> <to-stage-id>` BEFORE each `paseo run`, and
  `DEVIATION: <reason>` when departing from the playbook workflow.
- **Worker coordination guidance**: use `paseo wait <id>` and
  `paseo logs <id> --filter text` to capture worker output before proceeding.

### 5.5 Quarantined fallback lanes

The following lanes remain available for backward compatibility but are not the
mainline model:

- **Legacy marker bridge** (`WORKER_REQUEST: …`): the original marker-based dispatch
  from `TeamRunService`. Quarantined fallback only.
- **v1 lead-intent compatibility bridge**: adapters surface lead delegation intent to
  Pluto as `worker_requested` events; Pluto performs the mechanical worker
  launch/spawn fallback. Workflow/deviation reporting is synthesized from routing
  decisions. Quarantined fallback only.

## 6. What this supersedes

| Earlier framing | Status |
|---|---|
| "Document-first" product positioning | Superseded. Documents/Versions/Publish Packages are downstream governance objects, not the product entry point. |
| `TeamPlaybookV0` as stage/DAG/revision data | Superseded. Playbook is composition + workflow narrative + minimal audit side-data. |
| `TeamRunService` as deterministic stage dispatcher | Superseded. Pluto runs a manager-run harness path; TeamRunService is legacy bridge. |
| Pluto-mediated marker bridge (`WORKER_REQUEST: …`) | Quarantined fallback. Both the legacy marker bridge and the v1 lead-intent compatibility bridge remain available for backward compatibility but are not the mainline model. |
| v1 lead-intent compatibility bridge | Quarantined fallback. Adapters surface team_lead delegation intent and Pluto performs the mechanical spawn fallback. Superseded by v1.5 team-lead-owned orchestration where the lead spawns directly via `paseo run`. |
| EvidencePacket as run-level only | Extended. Stage-level evidence comes from `artifact_contract.required_files` plus observed STAGE/DEVIATION events in v1.5; synthesized routing transitions remain only in the quarantined v1 fallback lane. |
| Provider-specific terms in core types (`paseo_chat`, etc.) | Must move into adapter layer; core stays runtime-neutral. |

## 7. Open questions

- Outcome-style independent grader (separate context window from evaluator agent).
- `knowledge_refs` chunking, summarization, and a manifest of omitted refs when caps
  are hit.
- Multi-runtime support (currently hard-bound to Paseo).
- Recursive `callable_agents` (Claude Managed Agents allows only one level; Pluto
  matches that).
- Workflow→RunProfile binding: whether a Playbook can declare a default RunProfile or
  whether they always pair at run invocation.
- Marketplace / catalog distribution of Agents and Playbooks.
- Local Claude Code Opus 4.7 lead + OpenCode workers configuration (recorded as a
  follow-up plan).

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
