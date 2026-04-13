# Contracts

This directory stores canonical structural contracts for the core product objects.

Use these documents when you need:

- field names
- object envelopes
- event shapes
- normalized status enums
- schema-like object boundaries

These docs complement product specs. They do **not** replace product behavior docs or design rationale.

## Documents

- [playbook-contract.md](./playbook-contract.md) — canonical playbook shape
- [harness-contract.md](./harness-contract.md) — canonical harness shape
- [approval-contract.md](./approval-contract.md) — approval object and action-class contract
- [artifact-contract.md](./artifact-contract.md) — artifact identity and lineage contract
- [run-contract.md](./run-contract.md) — run, run plan, environment, session, and policy contracts
- [run-event-contract.md](./run-event-contract.md) — run event envelope and event categories
- [role-and-team-contract.md](./role-and-team-contract.md) — reusable role and team structures

## Relationship to other docs

- `docs/design-docs/` explains **why** the model is shaped this way
- `docs/product-specs/` explains **what behavior must be true**
- `docs/contracts/` explains **what the object shapes and envelopes look like**
- `docs/exec-plans/` explains **how implementation should be sequenced**
