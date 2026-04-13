# Product and Scope

## Purpose

This document defines the product, its terms, its target scope, and the minimum stable core.

## Product definition

Pluto Agent Platform is a workflow-oriented agent operations platform for coding-agent teams.

It is designed to turn agent work from isolated sessions into governed, durable runs with clear approvals, artifacts, and operator visibility.

## Product position

The platform is:

- not a pure chat-first agent client
- not a static workflow graph builder
- not a provider launcher only

It is a control plane where reusable task intent and governed execution become the primary product objects.

## Relationship to Paseo

Paseo provides the execution kernel and interaction substrate.

This project adds:

- governed run lifecycle
- product-level execution semantics
- durable approvals and artifacts
- operator-facing run views

## Target users

- engineering teams coordinating coding agents
- platform or developer-productivity teams
- technical operators who need observable and recoverable agent execution

## Core terms

### Playbook

A reusable task definition describing:

- goal
- inputs
- tools and systems
- expected outputs
- quality expectations

### Harness

A reusable governance skeleton describing:

- phases
- approvals
- retries and timeouts
- evidence rules
- observability rules

### Run

A durable execution instance created from a playbook, a harness, and specific run-time context.

### Run Plan

The visible run-time execution plan compiled for a specific run.

### Approval

A governed action request that must be resolved before protected execution can continue.

### Artifact

A formal output produced during a run and durably registered by the system.

### Role / Team

Reusable responsibility definitions and team compositions used during coordinated execution.

### EnvironmentSpec

A durable description of the execution context expected by a run or reusable task definition.

## Workflow language rule

The term `workflow` may be used as a broad umbrella phrase only. In formal product definitions, prefer **playbook**, **harness**, and **run**.

## In scope for the minimum stable core

Phase 1 should include:

- Playbook definition and listing
- Harness attachment and summary
- Run creation from a playbook
- visible Run status and phase progression
- durable approvals
- durable artifact registration
- operator-facing run list and run detail views
- enough session linkage to explain recovery and operator visibility

## Out of scope for the minimum stable core

Phase 1 should explicitly avoid or defer:

- full BPM or DAG authoring
- deep enterprise administration and RBAC
- broad multi-surface parity
- marketplace-style extensions
- advanced analytics beyond basic operator visibility
- over-generalized orchestration modes before the core run model is stable

## Explicitly deferred but retained in product direction

The following concepts remain part of the broader product direction but are not required in the minimum stable core unless later plans promote them:

- richer EnvironmentSpec behavior
- triggers and webhooks
- product-facing eval management
- mailbox-like coordination surfaces
- broader tenancy features
- richer role and team orchestration modes

## Minimum reference scenario

Phase 1 should be able to support a single coherent reference scenario:

1. an operator opens a playbook
2. starts a run with explicit input
3. the run enters governed phases
4. an approval may be requested
5. execution continues after approval resolution
6. artifacts are registered durably
7. the operator can inspect outcome and blocker history

This scenario is the minimum product cutline for validating the model.

## Product invariants

- a playbook is not the run itself
- a harness is not the task definition itself
- a run is the system's true execution object
- approvals are durable product objects
- artifacts are durable product objects
- operator views must explain state clearly enough to steer execution
