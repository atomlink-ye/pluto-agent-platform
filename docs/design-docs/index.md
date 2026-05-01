# Pluto Design Docs

This directory contains product-shape and architecture design notes for Pluto.
They describe the intended complete product model, while calling out where the
current repository is a local-first, file-backed skeleton rather than a
production multi-user system.

## Core docs

- [Core Concepts](./core-concepts.md) — canonical glossary and relationship model
  for Workspace, Document, Playbook, Agent Team, Run, Evidence, Publishing,
  Scheduling, Integrations, Extensions, and Portability.
- [Local File-backed Architecture](./local-file-backed-architecture.md) — how the
  current implementation validates object shape and orchestration semantics, and
  what must change for production persistence.
- [Product Shape](./product-shape.md) — high-level map of Pluto's user-facing
  surfaces, backstage runtime surfaces, capabilities, and local-vs-production
  boundary.
- [Runtime and Evidence Flow](./runtime-and-evidence-flow.md) — how runs,
  workers, artifacts, blockers, retries, redaction, and sealed evidence connect
  execution to governance.
- [Compliance and Governance Boundary](./compliance-governance-boundary.md) —
  governance chain, compliance controls, identity/security boundaries,
  fail-closed rules, and production enforcement gaps.

## Authority note

Generated or migrated planning records under `docs/plans/` and `.local/manager/`
are useful source material, but they are not authoritative product navigation.
For stable vocabulary, prefer this design-docs directory and the TypeScript
contracts under `src/contracts/`.
