# Pluto Core Concepts (Glossary)

Canonical reference: `docs/design-docs/agent-playbook-scenario-runprofile.md`.

## Foreground primary objects

### Agent

Stable role definition stored in `agents/*.yaml`.

### Playbook

Team composition + workflow narrative + audit policy stored in `playbooks/*.yaml`.

### Scenario

Business/task specialization stored in `scenarios/*.yaml`.

### RunProfile

Execution policy stored in `run-profiles/*.yaml`.

### Run

One execution of a resolved Agent + Playbook + Scenario + RunProfile stack.

### EvidencePacket

The sealed audit-lineage object emitted after validation.

## Runtime coordination concepts (v1.6)

### MailboxMessage

Typed teammate-to-teammate or teammate-to-lead message persisted to the mirrored mailbox
log. Core kinds include `text`, `shutdown_request`, `shutdown_response`,
`plan_approval_request`, and `plan_approval_response`.

### Task

Shared task-list record representing a unit of work with assignment, dependency, status,
and artifact linkage.

### Hook

An active control point run at task creation, task completion, or teammate-idle time.
Hooks can block continuation.

### PlanApprovalRoundTrip

The typed mailbox exchange where a teammate asks the team lead to approve a plan or
permission mode before proceeding.

## Downstream governance objects

### Document / Version

Downstream governed content surfaces that consume EvidencePacket lineage.

### Review

Quality/suitability decision request over a Version, section, or package, backed by the
EvidencePacket.

### Approval

Explicit authorization backed by the EvidencePacket and governed target.

### PublishPackage

Governed delivery object that assembles source versions, approvals, evidence refs, and
channel targets.

## Backstage execution objects

### Runtime Adapter / Provider Session

The adapter seam Pluto uses to launch and observe runtime work while keeping
provider-specific state out of foreground product objects.

### Audit Middleware

The fail-closed validation layer that checks files, mailbox/task state, citations, and
acceptance commands before sealing evidence.

## Boundary rules

- Foreground objects: Agent, Playbook, Scenario, RunProfile, Run, EvidencePacket.
- Downstream governance consumes EvidencePackets rather than raw runtime sessions.
- Backstage runtime state stays behind adapters and run-local evidence files.
- Stacking is additive: Agent -> Playbook -> Scenario -> RunProfile.
