# Repository Guide

This file serves as the primary entry point for coding agents in this repository. `AGENTS.md` should point to this file.

## Read order

Before changing code or documents, read in this order:

1. **This file**
2. [ARCHITECTURE.md](./ARCHITECTURE.md)
3. Relevant top-level topic doc (`DESIGN.md`, `FRONTEND.md`, `QUALITY_SCORE.md`, etc.)
4. The matching authority under `docs/`

Default conflict priority:

1. Task-relevant formal document
2. `ARCHITECTURE.md`
3. Top-level topic docs
4. Subdirectory index pages
5. Reference materials
6. Generated documents

## Documentation structure

Top-level docs provide repository-wide rules and topic-level guidance:

- `ARCHITECTURE.md` — system structure, module boundaries, dependency directions
- `DESIGN.md` — enduring design principles and conceptual boundaries
- `FRONTEND.md` — UI information architecture and frontend constraints
- `PLANS.md` — how execution plans are written and maintained
- `PRODUCT_SENSE.md` — scope and prioritization judgment
- `QUALITY_SCORE.md` — EDD rules and quality gates
- `RELIABILITY.md` — reliability requirements and recovery expectations
- `SECURITY.md` — security boundaries and forbidden patterns

`docs/` owns formal detailed knowledge:

- `docs/design-docs/` — design decisions, rationale, tradeoffs
- `docs/contracts/` — canonical structural contracts and schema-like object definitions
- `docs/product-specs/` — product behavior, domain rules, user-visible semantics
- `docs/exec-plans/` — implementation sequencing, EDD workflow, active plans, tech debt
- `docs/references/` — external or historical reference summaries
- `docs/generated/` — generated artifacts only; never the primary source of truth

## Documentation ownership rules

Before creating or editing a document, classify the information correctly.

| Information type | Location |
|---|---|
| Design principles, architecture decisions, tradeoffs | `docs/design-docs/` |
| Canonical schemas, field contracts, object shapes, event envelopes | `docs/contracts/` |
| Product behavior, domain objects, flows, acceptance rules | `docs/product-specs/` |
| Implementation sequence, phase plans, progress, evaluation workflow, tech debt | `docs/exec-plans/` |
| External references, upstream mappings, historical source summaries | `docs/references/` |
| Generated schemas, exports, machine-produced summaries | `docs/generated/` |

Do not mix these categories.

## Project model rules

The repository intentionally weakens the old idea of a rigid workflow definition.

- **Playbook** defines task intent, inputs, tools, desired outputs, and quality expectations
- **Harness** defines execution governance, phases, approvals, retries, evidence, and observability rules
- **Run** is the actual durable execution instance

Use the term **workflow** only as a loose umbrella term. In formal repository docs, prefer the more precise object names.

## EDD rules

This project follows **evaluation-driven development (EDD)**.

Every iteration must:

1. Define the evaluation target or acceptance bar first
2. Identify the authoritative documents
3. Implement the minimum coherent change
4. Verify the result against the defined quality gates
5. Update affected documents in the same iteration

The task is not complete if code changed but authoritative docs are stale.

## Working rules for coding agents

### Must do

- Locate the authoritative document before making changes
- Preserve the `design → spec → plan` boundary
- Update docs whenever architecture, scope, behavior, reliability, security, or quality rules change
- Consolidate duplicates instead of creating parallel documents
- Mark outdated knowledge explicitly if it cannot be updated immediately
- Keep terminology consistent across top-level docs and `docs/`

### Must not do

- Create ad hoc parallel documentation structures
- Put implementation plans into design docs
- Put design rationale into product specs when it belongs in design docs
- Treat references as local authority
- Treat generated outputs as human-owned truth
- Reintroduce rigid workflow semantics where playbook / harness / run is the intended model

## Repository-specific guidance

### Terminology discipline

Prefer:

- **Playbook** for task intent and reusable instructions
- **Harness** for execution governance and deterministic rules
- **Run** for the durable execution instance
- **Run Plan** for the visible execution plan compiled at run time

`workflow` may still appear as a broad product umbrella phrase, but it should not replace the formal object model.

### Consistency checklist after meaningful changes

After each substantial change, check:

- does `ARCHITECTURE.md` still match module boundaries?
- do top-level docs still reflect current constraints?
- do product specs still describe the intended behavior?
- do plans still reflect actual sequencing and debt?
- did any terminology drift back to old workflow language?

## Minimum task workflow

1. Read this file
2. Read `ARCHITECTURE.md`
3. Read the relevant topic doc
4. Read the matching detailed source under `docs/`
5. Make the change
6. Check all impacted docs
7. Update or mark affected docs in the same iteration

## Success criteria for repository changes

A repository change is only complete when:

- the implementation satisfies the stated acceptance bar
- the affected authoritative docs remain consistent
- the terminology still matches the formal model
- the change does not create duplicate truths
