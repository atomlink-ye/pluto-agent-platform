# Pluto Core Concepts (Glossary)

This glossary defines Pluto's canonical product objects in alignment with
`agent-playbook-scenario-runprofile.md`, which is the source of truth for the
playbook-first model. The foreground product is the four authored layers plus
Run and EvidencePacket: those are the objects users author, launch, inspect,
and govern. Downstream governance objects--Document, Version, Review,
Approval, and PublishPackage--consume EvidencePackets. Backstage objects such
as provider sessions, runtime adapters, raw logs, and file paths support
execution but do not become the product entry point.

Canonical reference: `docs/design-docs/agent-playbook-scenario-runprofile.md`.

## Foreground primary objects

### Agent

An Agent is a stable role definition stored as `agents/<name>.yaml`. It says
what the role is, which model/provider alias it uses through Paseo, what it is
good at, and what baseline system prompt should frame the role. Agents are
reused across Playbooks and are the lowest authored layer in the stack.

Key fields include `name`, `description`, `model`, `system`, and optional v1
Paseo bridge fields such as `provider`, `mode`, and `thinking`. The lifecycle
is author -> review -> version/pin -> referenced by Playbook members ->
included in Run evidence as `agent_versions[]`. Ownership belongs to the team
or platform owner who governs reusable execution roles. PM Space:
[Agent Definition & Skill Catalog](https://ocnb314kma1f.feishu.cn/wiki/N9w2wtcElimwOokPE34clO6onOf).

### Playbook

A Playbook is the composition and workflow layer stored as
`playbooks/<name>.yaml`. It names the `team_lead`, lists member Agents, and
contains the natural-language workflow narrative. It is prompt text, not a DAG;
Pluto does not topologically sort Playbook stages.

Key fields include `name`, `description`, `team_lead`, `members`, `workflow`,
and `audit`. `audit.required_roles`, `audit.max_revision_cycles`, and
`audit.final_report_sections` give audit middleware enough machine-checkable
discipline to validate the Run. The lifecycle is author -> validate member refs
-> bind to Scenario and RunProfile -> launch Run -> cite in EvidencePacket.
Ownership belongs to product/platform teams defining repeatable governed work.
PM Space: [Portable Workflow Contract](https://ocnb314kma1f.feishu.cn/wiki/G4Y8w2cgliV7v7kdosfcAxeWnHd).

### Scenario

A Scenario is the specialization layer stored as `scenarios/<name>.yaml`. It
binds to one Playbook and adds a concrete business context: fixed or templated
task, per-role overlays, knowledge references, and evaluator rubrics. Scenario
is the prompt-engineering surface for a reproducible benchmark or reusable
business variant.

Key fields include `name`, `playbook`, `task`, `task_mode`,
`allow_task_override`, and `overlays`. Overlay fields include role-specific
`prompt`, `knowledge_refs`, and `rubric_ref`. `knowledge_refs` are loaded by
Pluto under a `## Knowledge` heading and are capped at three refs, 8k tokens
total, and 4k per ref. The lifecycle is author -> validate Playbook ref and
caps -> choose at launch -> append to rendered role prompts -> cite in
EvidencePacket. PM Space: [Portable Workflow Contract](https://ocnb314kma1f.feishu.cn/wiki/G4Y8w2cgliV7v7kdosfcAxeWnHd).

### RunProfile

A RunProfile is the operational policy layer stored as
`run-profiles/<name>.yaml`. It is not prompt content. It defines where the Run
happens, what must be read, which commands must pass, what files and sections
must exist, what stdout must contain, what approval gates apply, and how
secrets are redacted.

Key fields include `workspace`, `required_reads`, `acceptance_commands`,
`artifact_contract`, `stdout_contract`, `concurrency`, `approval_gates`, and
`secrets`. The lifecycle is author -> validate workspace and gates -> bind at
Run launch -> enforce pre-launch and post-run checks -> feed EvidencePacket.
Ownership belongs to operators or platform teams responsible for execution
policy. PM Space: [Run, Audit Middleware & Evidence Packet Model](https://ocnb314kma1f.feishu.cn/wiki/V4mcwu6DmiYim1kEhI2cd8G3nMb)
and [Schedule, Trigger & Subscription Model](https://ocnb314kma1f.feishu.cn/wiki/G2f9wz2Ruivc1AkASPuc1vISn2g).

### Run

A Run is one observable execution attempt for a resolved Agent + Playbook +
Scenario + RunProfile stack. It launches the team lead through Paseo, observes
execution through audit middleware, and ends in a terminal status and
EvidencePacket emission.

Key fields include `id`, `playbook_id`, optional `scenario_id`,
`run_profile_id`, runtime state, timestamps, launch actor, workspace/worktree
refs, terminal status, blocker reason, and evidence ref. Lifecycle states are
`queued -> launching -> running -> paused_for_gate -> validating -> completed`
or `failed_audit`, `failed_command`, `failed_artifact`, or `cancelled`. PM
Space: [Run, Audit Middleware & Evidence Packet Model](https://ocnb314kma1f.feishu.cn/wiki/V4mcwu6DmiYim1kEhI2cd8G3nMb).

### EvidencePacket

An EvidencePacket is the audit-grade result emitted by Pluto after the Run is
observed and validated. It aggregates the rendered stack identity, chat events,
file checkpoints, stdout matches, command outputs, revision summary, redaction
summary, downstream refs, and audit status. It is the signal downstream
governance objects attach to by `evidence_packet_id`.

Key fields include `id`, `run_id`, `playbook_id`, optional `scenario_id`,
`run_profile_id`, `agent_versions[]`, `events[]`, `file_checkpoints[]`,
`stdout_matches[]`, `command_results[]`, `revision_summary`,
`redaction_summary`, `audit_status`, `downstream_refs[]`, `created_at`, and
`sealed_at`. Once sealed, it is immutable; redaction is irreversible. PM Space:
[Run, Audit Middleware & Evidence Packet Model](https://ocnb314kma1f.feishu.cn/wiki/V4mcwu6DmiYim1kEhI2cd8G3nMb).

## Downstream governance objects

### Document / Version

Document and Version are downstream content governance objects, not Pluto's
execution entry point. A Document is authored content. A Version is the stable
decision target for review, approval, and publish readiness. They may include
or reference Run artifacts, but they consume Run truth through
`evidence_packet_id` rather than recomputing it from raw logs.

Version decisions should cite the specific EvidencePacket considered by the
reviewer or approver. If the evidence changes, a new EvidencePacket or Version
relationship should be recorded rather than silently mutating decision history.
PM Space: [Core Object Model](https://ocnb314kma1f.feishu.cn/wiki/E2Itw8ERliNZOpkw4fTcIjA5nAf).

### Review

A Review is a quality or suitability decision request over a Version, section,
or package. In the playbook-first model, Review consumes the EvidencePacket that
proves what ran, which audit checks passed or failed, which deviations were
cited, and whether the artifact is decision-ready.

Review records attach by `evidence_packet_id`. They may pass, fail, request
changes, expire, or block, but they do not re-run acceptance commands or parse
provider transcripts as their source of truth. PM Space:
[Review & Approval Flow](https://ocnb314kma1f.feishu.cn/wiki/HASVwhHZ6iJ70Ok67HxcoahinDg).

### Approval

An Approval is an explicit authorization by an eligible approver. It is distinct
from Review: Review evaluates quality; Approval grants responsibility to
proceed. Approval inherits its evidence basis from the attached
EvidencePacket and the governed target it authorizes.

Approval records attach by `evidence_packet_id` when the authorization depends
on agent-produced work or audit middleware output. Missing, failed, invalid, or
unredacted evidence must block approval where policy requires evidence. PM
Space: [Review & Approval Flow](https://ocnb314kma1f.feishu.cn/wiki/HASVwhHZ6iJ70Ok67HxcoahinDg).

### PublishPackage

A PublishPackage is the governed delivery object. It assembles source Versions,
approval refs, EvidencePacket refs, release-readiness refs, channel targets,
export assets, publish attempts, rollback/retract/supersede records, and audit
events.

Publish readiness consumes EvidencePackets by `evidence_packet_id`. It should
block on failed audit, missing approvals, missing evidence, credential leakage,
or regulated publish gates. PM Space: [Publish Package Model](https://ocnb314kma1f.feishu.cn/wiki/A3x3w14jKiecXVkraZocF1ySnqh).

## Backstage execution objects

### Runtime Adapter / Provider Session

The Runtime Adapter lets Pluto launch and observe a runtime without putting
provider-specific state into core product types. v1 is hard-bound to Paseo, but
core objects stay runtime-neutral. The provider session is the runtime execution
instance created during a Run.

Provider sessions, callback payloads, raw transcripts, stderr, endpoints, and
private file paths are operator diagnostics. Governance consumers should see
redacted summaries and EvidencePacket refs, not raw provider state. PM Space:
[Runtime Adapter & Provider Contract](https://ocnb314kma1f.feishu.cn/wiki/IhdDwIqlwi0PpfkTUxEcz6v1nGe).

### Coordination Channel (paseo chat)

The coordination channel is the transcript / room handle passed to the team
lead at launch. In the shipped v1 manager-run harness, team lead still owns the
orchestration decisions, but adapters surface delegation intent and Pluto
performs the mechanical worker launch/spawn fallback. Room-backed
`STAGE`/`DEVIATION` observation remains the v1.5+ target model.

The chat room is not a foreground object. Pluto records relevant events into
the EvidencePacket after validation and redaction.

### Audit Middleware

Audit Middleware is the fail-closed validation layer driven by RunProfile and
Playbook audit fields. It observes file checkpoints, stdout matches,
synthesized workflow/deviation traces, acceptance commands, required role
citations, and revision cap behavior.

It does not decide the workflow. It verifies that the team lead's claimed work
is supported by contracted files, stdout, events, citations, and command
outputs. Any missing required element marks the run `failed_audit`,
`failed_command`, or `failed_artifact` as appropriate. PM Space:
[Run, Audit Middleware & Evidence Packet Model](https://ocnb314kma1f.feishu.cn/wiki/V4mcwu6DmiYim1kEhI2cd8G3nMb).

## Boundary rules

- Foreground objects are user-facing and governed: Agent, Playbook, Scenario,
  RunProfile, Run, and EvidencePacket.
- Downstream surfaces consume EvidencePackets; they do not recompute Run truth
  from raw logs, provider sessions, or mutable artifacts.
- Backstage is implementation detail; core types use runtime-neutral
  abstractions even though v1 launches through Paseo.
- Stacking is additive: Agent -> Playbook -> Scenario -> RunProfile appends
  context and policy; higher layers do not rewrite lower layers.
- EvidencePacket is the audit lineage signal across Document, Review,
  Approval, PublishPackage, compliance, portability, and audit export.

## Lifecycle examples

### Playbook-first governed execution

Playbook authoring -> Scenario specialization -> RunProfile binding -> Run
launch -> audit middleware -> EvidencePacket emission -> downstream
Document/Review/Approval/Publish consumption by `evidence_packet_id`.

### Schema versioning

The v1 four-layer YAML schema uses `pluto.dev/v1`. Additive changes should
preserve import/export compatibility where possible; breaking changes require a
compatibility report and migration plan. PM Space: [Versioning, Migration & Compatibility](https://ocnb314kma1f.feishu.cn/wiki/LVg4w7uYIiIBckkI6vNcofPmnDh).
