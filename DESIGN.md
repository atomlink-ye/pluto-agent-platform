# DESIGN.md

## Purpose

This document records enduring design principles and conceptual constraints for the repository.

## Design hierarchy

The repository follows a deliberate progression:

- **Design** explains principles, boundaries, and why
- **Spec** defines product behavior and object rules
- **Plan** defines how work will be executed in stages

Do not collapse these layers.

## Core design principles

### 1. Workflow-oriented, but not graph-first

The product remains workflow-oriented in the sense that users work with reusable task definitions and visible runs. It is **not** intended to become a static BPM or DAG authoring system.

### 2. Playbook is weakly defined by design

Playbook should remain close to a team lead’s reusable task instruction set:

- goal
- context
- tools and systems
- expected outputs
- quality expectations

It should not become a dump site for platform governance.

### 3. Harness provides deterministic structure

Harness is where platform certainty lives:

- phases
- approvals
- retries and timeouts
- artifact requirements
- evidence rules
- observability requirements

### 4. Run is the true execution object

Playbook is not executed directly.
Harness is not executed directly.
The system executes **Runs**.

This means user-facing status, operator visibility, replay, approvals, and artifacts should all center on the run.

### 5. Determinism comes from governed boundaries, not frozen paths

The system should avoid over-constraining execution paths too early. Determinism should come from:

- explicit phases
- visible state transitions
- durable events
- approval gates
- required artifacts and evidence

### 6. Product semantics must stay above the runtime kernel

Paseo provides the execution substrate. This repository adds product semantics on top. Runtime mechanics must not replace product-layer clarity.

### 7. Keep the model operator-legible

An operator must be able to answer:

- what this run is doing now
- what phase it is in
- why it is blocked
- which approvals are pending
- what artifacts were produced

If the system cannot answer those questions clearly, the design is too opaque.

### 8. Design for EDD

Each design decision should be testable or evaluable. If a concept cannot be expressed in acceptance terms, it is not ready for implementation.
