# Product Shape

Pluto is a document-first, governance-first AI work platform. The product thesis
is that AI-assisted work should be organized around durable content, versioned
decisions, evidence, and controlled publishing rather than around raw chat
sessions or runtime consoles.

This document describes the intended complete product shape at a high level. It
also marks the boundary between the current local file-backed skeleton and the
future production product.

## Product thesis

Pluto treats governed work as a chain of product objects:

```text
Workspace -> Document -> Version -> Review -> Approval -> Publish Package
```

AI execution supports that chain. Runs, adapters, provider sessions, artifacts,
and evidence generation are necessary, but they are not the main object users are
expected to manage. The main user promise is that an organization can know what
was authored, which version was reviewed, who approved it, what evidence was
considered, and what was published.

## Primary user-facing surfaces

### Workspace

The Workspace is the product and tenant boundary. It scopes documents,
playbooks, scenarios, schedules, integrations, catalog selections, governance
records, runs, artifacts, evidence, compliance controls, and audit records.

### Document

The Document is the primary content object. Users create, import, edit, and
organize work through Documents rather than through runtime sessions.

### Version

A Version is the decision target for review, approval, provenance, and publish
readiness. A Version must be stable enough that a reviewer or approver can later
reconstruct what was considered.

### Playbook

A Playbook is a reusable governed definition of work. It describes goals,
expected outputs, team shape, policy constraints, runtime requirements, and
portable workflow intent.

### Scenario

A Scenario is a concrete use case or variant under a Playbook. It narrows the
Playbook for a business context, input class, trigger path, or schedule.

### Review

A Review is a quality or suitability decision request. It can request changes,
pass, reject, expire, or be blocked. Review does not grant publish authority by
itself.

### Approval

An Approval is a distinct responsibility grant for a Version or Publish Package.
It records who authorized progress, under what role basis, with which evidence
and diff context.

### Publish Package

A Publish Package is the delivery object. It assembles source Version refs,
approval refs, sealed evidence refs, release readiness refs, channel targets,
export assets, publish attempts, and audit events.

### Schedule

A Schedule binds a Playbook and Scenario to future execution intent, such as
manual, cron, API, or event-driven triggers. Schedules should contain references
and policy, not secret values.

### Catalog

The Catalog governs reusable capability assets: worker roles, skills, templates,
policy packs, catalog entries, and extensions. Catalog versions provide
provenance for worker contributions.

### Integration

An Integration connects Pluto to external work sources, trigger sources, and
publish targets. It should expose provider-neutral refs, redacted summaries,
dedupe, idempotency, and approval state rather than raw provider payloads.

## Backstage surfaces

Backstage surfaces support product governance but should not become the main
navigation model.

- **Run:** observable execution attempt for a task, Playbook, Scenario, or team.
- **Adapter:** provider-neutral seam used to dispatch work and receive callbacks.
- **Provider session:** runtime-specific execution context that remains opaque to
  governance consumers.
- **Event log:** append-only execution timeline for dispatch, progress, blockers,
  retries, artifact creation, and completion.
- **Artifact:** output produced by a Run, often used as input to a Document
  Version or Publish Package, but not the final business delivery object.
- **Evidence generation:** redaction, validation, classification, and summarizing
  process that turns run signals into governance-facing evidence.
- **Local stores:** file-backed persistence used by the current skeleton to
  validate object shape and flow semantics.

## Capability map

| Capability | Product meaning |
|---|---|
| Authoring | Create and evolve Documents, Versions, templates, and structured work inputs. |
| Orchestration | Dispatch agent teams from Playbooks and Scenarios through eligible runtimes. |
| Evidence | Convert execution results into redacted, validated Evidence Packets and Sealed Evidence. |
| Review and approval | Separate quality review from authorization, with evidence and diff context. |
| Publishing | Package approved Versions, sealed evidence, channel targets, exports, and publish attempts. |
| Scheduling and integration | Trigger governed work from schedules, APIs, webhooks, or external work sources. |
| Portability | Export safe definitions and summaries without tenant-private or runtime-private state. |
| Observability | Track run health, adapter health, metrics, budgets, alerts, and redacted traces. |
| Compliance | Apply retention, legal hold, deletion decisions, audit export, and regulated publish gates. |
| Extension and catalog | Govern reusable worker roles, skills, templates, policies, and installable extensions. |

## Current local skeleton vs intended full product

The current repository is a local file-backed skeleton. It is useful for proving
contract shape, object relationships, orchestration semantics, evidence
generation, redaction boundaries, readiness gates, and CLI flows.

It does not claim production readiness. In particular, the local skeleton does
not enforce production multi-tenant isolation, transactional persistence,
durable queues, hosted secret resolution, webhook delivery infrastructure,
centralized observability, backup and restore, or jurisdiction-specific
compliance policy.

The intended full product keeps the same document-first and governance-first
shape while replacing local stores and local-only controls with production-grade
persistence, authorization, queueing, event delivery, key management,
observability, and compliance enforcement.
