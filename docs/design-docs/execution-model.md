# Execution Model

## Purpose

This document defines the core execution model and the conceptual boundaries between the main objects.

## Terminology shift

The repository intentionally weakens the old idea of `workflow` as the primary system object.

The reason is architectural and product-level:

- `workflow` too easily implies static DAGs, rigid stages, and pre-authored graphs
- agent-team execution often needs run-time planning and coordination rather than frozen execution paths

The product may still describe itself as workflow-first in broad language, but the actual model is:

- **Playbook**
- **Harness**
- **Run**

## Why not a rigid workflow model

A rigid workflow-first model would push the system toward:

- static graph authoring
- strong compile-time step order
- over-specified execution paths
- premature loss of agent-team flexibility

That is not the target. The system should preserve flexible run-time coordination while still enforcing governance and observability.

## Core objects

### Playbook

Playbook is a reusable task definition written from a team-lead perspective.

It defines:

- goal
- context and inputs
- tools and external systems
- desired outputs
- quality expectations
- suggested role usage

It does **not** define platform governance such as retries, approvals, or observability contracts.

### Harness

Harness is the platform-defined execution skeleton.

It defines:

- phases
- approval rules
- retry and timeout rules
- evidence expectations
- artifact registration requirements
- observability expectations

It does **not** define the business task itself.

### Run

Run is the durable execution instance created from:

- a playbook
- a harness
- runtime inputs
- environment context
- team configuration

Run is the real execution object. UI, auditability, approvals, and recovery should all center on it.

### Run Plan

Run Plan is the visible, partially structured execution plan compiled at run time.

It is not a hand-authored static workflow graph. It is the system's visible operating plan for a specific run.

### EnvironmentSpec

EnvironmentSpec defines the declared execution environment assumptions for a run or a class of runs.

It may include concerns such as:

- available tools or integrations
- repository or workspace context
- execution constraints relevant to the run

It should remain a durable product-layer concept rather than an implicit runtime accident.

### RunSession

RunSession links a governed run to one or more concrete runtime sessions.

Its purpose is to preserve the boundary between:

- product truth about the run
- runtime-specific execution handles and session state

### Effective Policy Snapshot

An effective policy snapshot represents the actual policy boundary applied to a run after combining harness defaults, repository rules, and any higher-level policy overlays.

### Role and Team

Roles define responsibilities, not fixed steps. Teams group reusable roles for coordinated execution.

Examples of role responsibilities:

- researcher
- analyst
- implementer
- reviewer
- verifier

## Responsibility split

### Playbook owns task semantics

Playbook answers:

- what is this task trying to achieve?
- what inputs and tools matter?
- what outputs are expected?
- what quality bar should be met?

### Harness owns deterministic governance

Harness answers:

- what phases exist?
- what approvals are required?
- what evidence must exist?
- what time and retry constraints apply?

### Run owns execution truth

Run answers:

- what is happening now?
- what phase is active?
- what is blocked?
- what artifacts exist?
- what approvals are pending or resolved?

## Team orchestrator relationship

Playbook does not replace a run-time orchestrator.

Instead:

- Playbook provides reusable task intent
- Harness provides execution boundaries
- a lead role or orchestrator coordinates the actual run-time decisions
- Run records the governed result

The orchestrator should be treated as a run-time planner within those boundaries, not as an excuse to hide execution logic behind an opaque prompt-only black box.

This is important because the system must support dynamic execution choices without becoming an ungoverned black box.

## Determinism model

Determinism does not come from forcing users to author the full execution graph up front.

It comes from:

- explicit phases
- visible state transitions
- durable events
- approval gates
- registered artifacts
- replayable run state

## Event model expectation

Run events should be rich enough to explain at least:

- run creation and initialization
- phase changes
- runtime session linkage
- approval requests and resolutions
- artifact registration
- interruption and recovery-relevant transitions
- terminal outcomes

## Anti-patterns

- putting approvals inside playbooks
- putting business task semantics inside harnesses
- treating run-time coordination as invisible magic
- using `workflow` to blur object boundaries
