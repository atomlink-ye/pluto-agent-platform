# RELIABILITY.md

## Purpose

This document defines reliability expectations for the platform.

## Reliability goals

The system should be:

- recoverable
- observable
- governable
- resumable

## Core reliability requirements

### 1. Runs must remain operator-legible

At minimum, the system should make it clear:

- current run status
- current phase
- blocker reason
- pending approvals
- produced artifacts

### 2. Durable state must survive runtime interruption

If a runtime session ends unexpectedly, the platform should still preserve enough durable state to explain what happened and what remains actionable.

### 3. Recovery must be explicit

Recovery behavior should not be magical. A resumed run should have:

- visible prior status
- visible interruption history when relevant
- a clear next actionable state

### 3.1 Minimum resume contract

For the minimum stable core, recovery behavior should preserve or reconstruct enough state to answer:

- what run was active
- what phase it had reached
- whether an approval was pending
- which artifacts had already been registered
- whether a runtime session linkage existed and whether it is resumable or terminal

### 4. Artifact and approval handling must be durable

An approval request or artifact registration must not disappear because a client view reloads or a runtime process restarts.

## Minimum V1 reliability bar

- run summary can be reconstructed from durable state
- blocked and waiting-approval states are visible
- artifact metadata is durable
- operator can see whether a run is resumable or terminal
- interrupt and resume semantics are explicit enough to evaluate

## Reliability anti-patterns

- relying on transient runtime memory as the only truth
- hiding failure reasons in low-level logs only
- treating approvals as ephemeral UI prompts
- producing artifacts without durable registration
