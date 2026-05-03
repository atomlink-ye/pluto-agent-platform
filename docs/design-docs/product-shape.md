# Pluto Product Shape

Canonical reference: `docs/design-docs/agent-playbook-scenario-runprofile.md`.

## Product thesis

Pluto is a **playbook-driven, governance-first agent operations platform**.

Users author `Agent`, `Playbook`, `Scenario`, and `RunProfile` YAML, launch governed
Runs, observe those Runs through audit middleware, and consume audit-grade
EvidencePackets.

The runtime is **Claude-Code-Agent-Teams aligned**: mailbox + shared task list + active
hooks + plan-approval round-trip, with paseo chat as the target mailbox transport after
`agent-teams-chat-mailbox-runtime` Stage B and run-local file mirrors as durable evidence.

## Product entry point

The entry point is Playbook + Run, not Document. Documents, Versions, Reviews,
Approvals, and PublishPackages remain important downstream governance objects, but they
consume EvidencePackets rather than owning execution truth.

## Capability map

| Capability | Surface |
|---|---|
| Authoring | Agent / Playbook / Scenario / RunProfile YAML |
| Orchestration | mailbox + task list + hooks + plan approval |
| Operational policy | RunProfile workspace, reads, gates, contracts |
| Evidence | EvidencePacket with mailbox/task/file/command lineage |
| Governance | Document / Review / Approval / PublishPackage attach by evidence ref |
| Portability | Playbook bundle export/import |

## Local skeleton vs production

The current repository is a local file-backed skeleton suitable for shape validation and
runtime proof. Production still needs durable storage, queues, tenancy, compliance
enforcement, and operational controls, but the foreground product model stays the same.
