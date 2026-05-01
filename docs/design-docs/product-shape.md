# Pluto Product Shape

Canonical reference: `docs/design-docs/agent-playbook-scenario-runprofile.md`.
PM Space context: [Playbook-first Information Architecture](https://ocnb314kma1f.feishu.cn/wiki/CKqawMjLJi4Z3LkHN2Mc2beOnEc),
[Core Object Model](https://ocnb314kma1f.feishu.cn/wiki/E2Itw8ERliNZOpkw4fTcIjA5nAf),
and [Run, Audit Middleware & Evidence Packet Model](https://ocnb314kma1f.feishu.cn/wiki/V4mcwu6DmiYim1kEhI2cd8G3nMb).

## Product thesis

Pluto is a playbook-driven, governance-first agent operations platform. Users
author a small set of YAML files--Agent, Playbook, Scenario, and RunProfile--to
describe the team, workflow, specialization, and execution policy. They launch
governed Runs, observe those Runs through audit middleware, and consume
audit-grade EvidencePackets. v1 hard-binds to Paseo as the agent runtime.

The product entry point is Playbook + Run, not Document. Documents, Versions,
Reviews, Approvals, and PublishPackages remain important downstream governance
objects, but they consume EvidencePackets rather than owning execution truth.
This keeps AI work governable without turning raw chat sessions or provider
consoles into the navigation model.

## User-facing surfaces

### Playbook Catalog

The Playbook Catalog is the first-class discovery surface for repeatable agent
team workflows. It lists governed Playbooks, their descriptions, owners,
compatible Scenarios, required Agents, version metadata, and operational status.
PM Space: [Portable Workflow Contract](https://ocnb314kma1f.feishu.cn/wiki/G4Y8w2cgliV7v7kdosfcAxeWnHd).

### Playbook Detail (with Scenario picker, RunProfile binder)

Playbook Detail shows the team lead, member Agents, workflow narrative, audit
rules, known Scenarios, and compatible RunProfiles. The user can choose a
Scenario, bind a RunProfile, review pre-launch gates, and start a Run.

### Scenario Detail

Scenario Detail explains the business context: fixed or templated task,
role-specific prompt overlays, knowledge references, evaluator rubric, and
whether runtime task override is allowed. It is the domain-specialization
surface for repeatable work.

### RunProfile Binder

RunProfile Binder is the launch-policy surface. It resolves workspace,
worktree, required reads, acceptance commands, artifact contract, stdout
contract, concurrency, approval gates, and secrets redaction before launch. It
should fail closed on missing gates or invalid contracts.

### Run Observation (logs + checkpoint files + STAGE/DEVIATION + commands)

Run Observation shows the bounded runtime signals Pluto is allowed to treat as
evidence: team lead stdout, required file checkpoints, `STAGE` and `DEVIATION`
events from the Paseo chat room, acceptance command results, and terminal audit
status. It is not a raw provider-session console.

### EvidencePacket Inspector

EvidencePacket Inspector is the decision-grade audit view. It shows the Run,
resolved Playbook/Scenario/RunProfile refs, agent versions, events, file
checkpoints, stdout matches, command results, revision summary, redaction
summary, downstream refs, and sealed status. PM Space:
[Run, Audit Middleware & Evidence Packet Model](https://ocnb314kma1f.feishu.cn/wiki/V4mcwu6DmiYim1kEhI2cd8G3nMb).

### Downstream governance views

Document Detail, Review queue, Approval queue, and PublishPackage view consume
EvidencePackets by `evidence_packet_id`. They should display the evidence basis
for decisions without recomputing Run truth from raw logs. PM Space:
[Review & Approval Flow](https://ocnb314kma1f.feishu.cn/wiki/HASVwhHZ6iJ70Ok67HxcoahinDg)
and [Publish Package Model](https://ocnb314kma1f.feishu.cn/wiki/A3x3w14jKiecXVkraZocF1ySnqh).

### Schedule and Trigger views

Schedule and Trigger views resolve Playbook + Scenario + RunProfile before
submitting a Run. They should show the selected stack, owner, launch policy,
budget or concurrency constraints, missed-run behavior, and any manual gates.
They should not embed secrets or raw provider session state. PM Space:
[Schedule, Trigger & Subscription Model](https://ocnb314kma1f.feishu.cn/wiki/G2f9wz2Ruivc1AkASPuc1vISn2g).

### Integration and writeback views

Integration views map inbound work sources to Scenarios and outbound writeback
targets to downstream EvidencePackets. Inbound work should create or enqueue a
Run through the same four-layer resolution path as a manual launch. Outbound
writeback should attach the EvidencePacket considered by the decision or
publish path. PM Space: [Integration, Webhook & Work Source Adapter Model](https://ocnb314kma1f.feishu.cn/wiki/KMnkwxN5jiZ8vqkOTfqcNym0neg).

### Portability views

Portability views export and import safe Playbook bundles and related summaries
without tenant-private state, credentials, raw provider sessions, or private
storage paths. Workflow portability starts with Agent, Playbook, Scenario, and
RunProfile; broader portability can include Document, template, PublishPackage,
and EvidencePacket summaries. PM Space: [Portability Beyond Workflow](https://ocnb314kma1f.feishu.cn/wiki/XlavwwfW9i6kAFk3RGCcM3dQnyf).

## Differentiation vs Anthropic Claude Managed Agents

Anthropic Claude Managed Agents provide Agent + Environment + Session
primitives, with `callable_agents` for one-level multi-agent delegation. Those
are useful runtime primitives but do not by themselves define a portable,
governed enterprise workflow model.

Pluto extends the shape with Playbook, Scenario, RunProfile, and audit
middleware. Playbook composes Agents and provides workflow narrative. Scenario
specializes a Playbook for a business context and knowledge set. RunProfile
binds operational policy: workspace, worktree, gates, file/stdout contracts,
commands, concurrency, and secrets handling. Audit middleware turns runtime
activity into an EvidencePacket. The result is that an enterprise team can
stand up governed, auditable agent team workflows as configuration rather than
glue code.

## Capability map

| Capability | Surface |
|---|---|
| Authoring | Agent / Playbook / Scenario / RunProfile YAML |
| Composition | Playbook references Agents; Scenario specializes Playbook |
| Operational policy | RunProfile defines workspace, gates, contracts, concurrency |
| Orchestration | team_lead owns end-to-end; spawns members via paseo CLI |
| Audit | required_files / required_sections / stdout_contract / STAGE+DEVIATION events / acceptance_commands / revision cap (fail-closed) |
| Evidence | EvidencePacket aggregates events, file checkpoints, command outputs, redaction summary, downstream refs |
| Governance | Document/Version/Review/Approval/PublishPackage attach by `evidence_packet_id` |
| Portability | Playbook bundle export/import (Portable Workflow Contract) |
| Schedule/Trigger | Resolves Playbook+Scenario+RunProfile, submits Run |
| Integration | Inbound work spawns Run via Scenario; outbound writeback attaches EvidencePacket |

## Local skeleton vs production

The current repository is a local file-backed skeleton suitable for shape and
contract validation. It validates the playbook-first object model, local
orchestration semantics, evidence generation shape, redaction boundaries,
readiness gates, and CLI flows. It is appropriate for product-shape hardening
and offline tests.

Production needs durable persistence, transactional stores, queueing, webhook
delivery, secret resolution, observability, compliance enforcement,
multi-tenant isolation, backup and restore, and operational incident controls.
Product concepts in this doc remain stable across that transition: Agent,
Playbook, Scenario, RunProfile, Run, and EvidencePacket stay foreground, while
Document, Review, Approval, and PublishPackage stay downstream consumers of
EvidencePacket lineage.

Production scope is tracked in PM Space specs including
[Storage, Persistence & Retention Model](https://ocnb314kma1f.feishu.cn/wiki/KH0HwrIHZinKfxkR5OCc3U4inIg),
[Identity, Access, RBAC & Multi-tenant Boundary](https://ocnb314kma1f.feishu.cn/wiki/GFM6waZPtiLrJ9kQJHLcQAiDnVe),
[Security, Privacy & Scoped Tool Gateway](https://ocnb314kma1f.feishu.cn/wiki/WSgwwvjSUiTquykyFgzcn6Gcnkw),
and [Compliance & Regulatory Controls](https://ocnb314kma1f.feishu.cn/wiki/RO0PwjJlLiwLRokB6dJcxEhanrf).
