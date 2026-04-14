# FRONTEND.md

## Purpose

This document defines frontend information architecture and UI-facing constraints.

## Frontend stance

The UI should be **run-first and operator-oriented**, not terminal-first.

Paseo gives the repository a strong interaction shell, but the product surface here is different. The operator should primarily navigate through product objects, not runtime implementation details.

## Primary navigation bias

Preferred V1 navigation:

- Playbooks
- Runs

Approvals, artifacts, sessions, and operator/debug detail are currently surfaced inside **Run Detail** rather than as separate primary navigation destinations.

Dedicated Approvals and Artifacts list views may be added later, but they are not required for the current minimum coherent operator surface.

Teams may exist in the model before they become a primary V1 navigation destination.

## Information hierarchy

### Business layer first

Users should first see:

- what the task is
- which run is active
- current phase and status
- approvals and blockers
- produced outputs

### Runtime layer second

Timeline internals, raw session detail, and terminal-like traces should remain available but secondary.

## Key screen expectations

### Playbook detail

- explains task intent
- shows expected inputs and outputs
- shows the attached harness summary
- allows creating a run

### Run list

- status
- current phase
- blocker state
- owning playbook
- recent activity

### Run detail

Must clearly separate:

1. business summary
2. governance state
3. operator/debug detail

### Approval surfaces

- pending approvals should be explicit and high visibility
- approval context should include run linkage, requested action, and consequences
- approval resolution may happen from the run detail surface until a dedicated approvals queue exists

## V1 frontend constraints

- optimize first for one coherent operator surface
- avoid broad surface-area rewrites before the core run model is stable
- prefer incremental product routes over a full shell rewrite on day one
- keep product terminology consistent everywhere in the UI

## Frontend anti-patterns

- making raw agent sessions the primary object
- exposing workflow graph metaphors that imply rigid pre-authored DAGs
- collapsing approvals, artifacts, and status into low-signal activity streams
- hiding blocker state inside debug-only views
