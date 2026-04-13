# Redesign Source Map

## Purpose

This document explains how the raw redesign reference materials were distilled into the repository's formal documentation set.

## Source groups

### `.local/refDoc/repo-structure.md`

Contributed:

- repository doc taxonomy
- reading order
- ownership rules for design, specs, plans, references, and generated content

Mapped mainly into:

- `CLAUDE.md`
- `PLANS.md`
- directory index pages under `docs/`

These references are historical design inputs. If `.local/` is cleaned later, this mapping should be treated as a historical note rather than a live path contract.

### `.local/refDoc/product-redesign/reference/design-01.md`

Contributed:

- product vision and positioning
- the workflow-first but not chat-first direction
- the later terminology update from workflow to playbook / harness / run

Mapped mainly into:

- `README.md`
- `DESIGN.md`
- `docs/product-specs/product-and-scope.md`
- `docs/design-docs/execution-model.md`

### `.local/refDoc/product-redesign/reference/design-02.md`

Contributed:

- why workflow should be weakened as a rigid top-level concept
- the playbook / harness / run model
- run-time orchestration relationship

Mapped mainly into:

- `DESIGN.md`
- `ARCHITECTURE.md`
- `docs/design-docs/execution-model.md`
- `docs/product-specs/core-domain-model.md`
- `docs/product-specs/run-governance.md`
- `docs/contracts/*.md`

### `.local/refDoc/product-redesign/reference/design-03.md`

Contributed:

- schema direction for playbook, harness, run events, role, and team
- object responsibilities and field boundaries

Mapped mainly into:

- `docs/product-specs/core-domain-model.md`
- `docs/product-specs/run-governance.md`
- `docs/design-docs/execution-model.md`
- `docs/contracts/*.md`

### `.local/refDoc/product-redesign/reference/test-design-04.md`

Contributed:

- model-first TDD direction
- strong emphasis on observable, recoverable, governed execution
- layered testing strategy

Mapped mainly into:

- `QUALITY_SCORE.md`
- `docs/exec-plans/testing-and-evaluation-strategy.md`
- `docs/product-specs/run-governance.md`

### `.local/refDoc/product-redesign/paseo-fork-architecture-review.md`

Contributed:

- single-system fork direction
- runtime-kernel vs product-layer distinction
- source-of-truth boundaries
- tenancy caution and operator-facing architectural constraints

Mapped mainly into:

- `ARCHITECTURE.md`
- `docs/design-docs/system-architecture.md`
- `docs/product-specs/product-and-scope.md`

These references are historical design inputs. If `.local/` is cleaned later, this mapping should be treated as a historical note rather than a live path contract.

## Local repository decisions added during normalization

The formal repository docs also lock in local decisions that should be treated as authoritative here:

- TypeScript is the implementation language
- Postgres is the durable product database
- EDD is the governing delivery model
- design, spec, and plan responsibilities are intentionally separated

## Intentionally deferred or compressed concepts

Some redesign concepts were kept in direction but compressed or deferred in the first normalized pass. These include:

- richer EnvironmentSpec behavior
- deeper RunSession detail
- triggers and webhooks
- mailbox-like coordination product surfaces
- richer eval productization
- broader tenancy features

## Important note

The raw redesign inputs were exploratory and expansive. The repository docs intentionally condense and tighten them into a smaller, more authoritative structure.
