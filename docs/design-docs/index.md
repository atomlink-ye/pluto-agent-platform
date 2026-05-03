# Pluto Design Docs

This directory contains product-shape and architecture notes for Pluto.

## Core docs

- [Agent / Playbook / Scenario / RunProfile](./agent-playbook-scenario-runprofile.md)
  — authoritative four-layer + v1.6 runtime model.
- [Core Concepts](./core-concepts.md) — glossary aligned to the v1.6 model.
- [Product Shape](./product-shape.md) — high-level product framing.
- [Runtime and Evidence Flow](./runtime-and-evidence-flow.md) — mailbox/task-list runtime
  and evidence lineage.
- [Pluto / Paseo Runtime Boundary](./pluto-paseo-runtime-boundary.md) — ownership
  matrix and boundary rules for Pluto-as-control-plane over Paseo.
- [Local File-backed Architecture](./local-file-backed-architecture.md) — current
  file-backed implementation boundary.
- [Compliance and Governance Boundary](./compliance-governance-boundary.md) — governance
  chain and production enforcement boundary.

## Authority note

`agent-playbook-scenario-runprofile.md` is the source for the other design docs and the
PM-space mirror updates.

For the docs-as-config seam specifically, use `pluto-paseo-runtime-boundary.md` together
with the active refactor plan in `docs/plans/active/pluto-paseo-docs-as-config-refactor.md`.
