# Pluto Design Docs

This directory contains product-shape and architecture design notes for Pluto.
They describe the intended complete product model, while calling out where the
current repository is a local-first, file-backed skeleton rather than a
production multi-user system.

## Core docs

- [Agent / Playbook / Scenario / RunProfile](./agent-playbook-scenario-runprofile.md)
  — authoritative four-layer model.
- [Core Concepts](./core-concepts.md) — canonical glossary aligned to the
  four-layer model.
- [Product Shape](./product-shape.md) — high-level product map, Playbook-first
  framing.
- [Runtime and Evidence Flow](./runtime-and-evidence-flow.md) — manager-run
  harness path, file checkpoints, STAGE/DEVIATION events; aligned to the
  canonical four-layer model.
- [Local File-backed Architecture](./local-file-backed-architecture.md) — how the
  current implementation validates object shape and orchestration semantics, and
  what must change for production persistence.
- [Compliance and Governance Boundary](./compliance-governance-boundary.md) —
  governance chain, compliance controls, identity/security boundaries,
  fail-closed rules, and production enforcement gaps; aligned to the canonical
  four-layer model.

## Authority note

Design docs in this directory are authoritative for Pluto product shape and
architecture. `agent-playbook-scenario-runprofile.md` is the SOURCE for all other
design-docs and PM space mirror updates. Generated or migrated planning records
under `docs/plans/` and `.local/manager/` are useful source material, but they
must be reconciled back to this source before they are treated as stable product
navigation.
