# Core Domain Model

## Purpose

This document defines the core product objects and their behavioral boundaries.

## 1. Playbook

### Definition

Playbook is a reusable task template.

### Responsibilities

- define the task goal
- define required or expected inputs
- describe required tools and systems
- define expected outputs
- define the quality bar
- suggest preferred roles or team shape

### Must not include

- approval policy
- retry policy
- timeout policy
- observability policy
- audit rules

Those belong to Harness.

### Minimum expected fields

- name
- description
- inputs
- goal
- instructions
- context
- outputs or artifact expectations
- quality bar

## 2. Harness

### Definition

Harness is a reusable execution-governance template.

### Responsibilities

- define phases
- define approval rules
- define timeout and retry expectations
- define evidence requirements
- define artifact registration requirements
- define observability expectations

### Must not include

- business task intent
- user-facing task goal
- task-specific output prose templates

Those belong to Playbook.

## 3. Run

### Definition

Run is the durable execution instance formed from:

- one Playbook
- one Harness
- one concrete input set
- one environment context
- one role or team configuration

### Responsibilities

- carry execution state
- expose current phase
- expose blocker state
- link approvals and artifacts
- link environment and runtime sessions
- provide operator-visible outcome state

### Minimum lifecycle states

- `queued`
- `initializing`
- `running`
- `waiting_approval`
- `blocked`
- `succeeded`
- `failed`
- `canceled`

The final exact state set may evolve, but the system must clearly distinguish active, blocked, approval-waiting, and terminal states.

## 4. Run Plan

### Definition

Run Plan is the visible execution plan for one run.

### Responsibilities

- show expected phases
- show active and pending work segments
- show responsible roles when known
- show current blockers or gates

### Important rule

Run Plan is compiled at run time. It is not a requirement that users author a full static workflow graph ahead of time.

## 5. EnvironmentSpec

### Definition

EnvironmentSpec defines the durable execution-context assumptions attached to a playbook, harness, or run.

### Typical concerns

- repository or workspace references
- enabled integrations or external systems
- declared execution constraints relevant to the run

## 6. RunSession

### Definition

RunSession links a governed run to one or more concrete runtime sessions.

### Responsibilities

- preserve runtime linkage without turning runtime state into the product source of truth
- support operator-visible recovery context
- record session lifecycle state

### Current session status vocabulary

Production code writes only two `RunSession.status` values today:

- `active` — session is live and bound to a runtime agent
- `failed` — session recovery failed; session is unrecoverable

The following values appear in earlier documentation but are **not yet implemented** in production code:

- `interrupted` — planned: session was interrupted by runtime failure
- `resumed` — planned: session was resumed after interruption
- `closed` — planned: session completed normally

`RunSession.status` is currently an unconstrained `string` in contracts. See `run-contract.md` for the full status table and known debt notes.

## 7. Run Event

### Definition

Run Event is a durable event record that explains meaningful execution progress.

### Purpose

- preserve execution history
- support replay and summary projection
- explain approvals, blockers, and artifact production

### Event expectations

At minimum, events should be sufficient to explain:

- run creation
- phase changes
- runtime session linkage
- approval requests and resolutions
- artifact registration
- interruption and recovery-relevant transitions
- terminal outcomes

## 8. Approval

### Definition

Approval is a governed request for protected execution.

### Responsibilities

- identify the action under review
- identify the run context
- record current decision state
- record resolution metadata

### Minimum states

- `pending`
- `approved`
- `denied`
- `expired` or equivalent if introduced later

## 9. Artifact

### Definition

Artifact is a formal output of a run.

### Responsibilities

- identify the output
- link it to a run
- capture type and purpose
- capture lineage and producer metadata

### Boundary rule

Artifact payload may live in runtime-local or file storage, but artifact identity and metadata must be durable product-layer records.

## 10. Policy Snapshot

### Definition

Policy Snapshot records the effective policy boundary applied to a run.

### Purpose

- preserve the actual governed rules in force for that run
- distinguish reusable harness defaults from effective run-time policy

## 11. RoleSpec

### Definition

RoleSpec defines a reusable responsibility profile.

### Typical concerns

- purpose
- tool policy or requested tools
- memory scope
- provider or execution preference
- isolation preference

### Important rule

Roles describe responsibilities, not mandatory fixed steps.

## 12. TeamSpec

### Definition

TeamSpec groups roles for coordinated execution.

### Typical concerns

- included roles
- coordination mode
- default lead role or supervisory mode
- worktree policy preference

## 13. Cross-object rules

### Playbook + Harness + Context => Run

The system should always make it explicit that a run is created from reusable intent plus reusable governance plus concrete execution context.

### Harness constrains but does not fully script

Harness should constrain execution without turning every run into a fully pre-authored graph.

### Run is always operator-visible

A run must expose enough state for an operator to know what is happening, what is blocked, and what remains actionable.

### Approvals and artifacts are first-class

They must not be hidden inside raw event streams only.

### Environment and session boundaries must remain visible

Environment and runtime session linkage are part of the product model because they affect recovery, replay, and operator understanding, even though runtime-local details remain non-authoritative.
