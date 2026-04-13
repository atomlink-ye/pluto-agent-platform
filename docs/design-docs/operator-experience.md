# Operator Experience

## Purpose

This document defines the intended operator experience and information architecture principles.

## Product-facing UX principle

The platform should feel **run-first, governed, and operator-legible**.

It should not feel like a thin wrapper around raw agent sessions.

## Primary navigation model

Preferred top-level navigation:

- Playbooks
- Runs
- Approvals
- Artifacts
- Teams
- Operator / Debug

## Business-first hierarchy

The first thing a user should understand is:

- what the task is
- what run is active
- what phase the run is in
- whether anything is blocked
- what has been produced

Only after that should the user need to inspect lower-level runtime detail.

## Screen principles

### Playbook detail

Should emphasize:

- task intent
- expected inputs
- expected outputs
- quality bar
- attached harness summary

### Run list

Should help an operator scan:

- status
- phase
- blocker state
- owning playbook
- recency and progress signal

### Run detail

Should separate three layers clearly:

1. **business layer** — what this run is for
2. **governance layer** — approvals, blockers, artifacts, evidence
3. **operator/debug layer** — raw event and runtime-level detail

## Approval experience

Approvals must not feel like incidental popups. They are part of the governed execution model and should be visible as durable objects linked to the run.

## Artifact experience

Artifacts should appear as formal outputs with enough metadata to understand:

- what was produced
- by whom or by which role
- in which run context
- what it is for

## Debug visibility

Debug views should exist, but they should be a lower layer rather than the default product story.

## Phase 1 UX caution

Do not attempt a complete shell rewrite before the product-layer contracts are stable. Phase 1 should validate the run-first model with a coherent operator surface and clear status semantics.
