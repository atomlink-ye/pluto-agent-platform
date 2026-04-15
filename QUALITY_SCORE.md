# QUALITY_SCORE.md

## Purpose

This document defines quality expectations and the repository-wide delivery bar.

## Delivery model: EDD first

This repository uses **evaluation-driven development (EDD)**.

For every iteration:

1. define the evaluation target first
2. implement the minimum coherent slice
3. verify the result
4. reconcile documents immediately

TDD is used inside that broader EDD discipline. Tests are one mechanism; evaluation is the repository-wide operating model.

## Required quality gates

An iteration is acceptable only when all of the following are true:

- the change satisfies its stated acceptance bar
- the object model remains internally consistent
- authoritative docs still match the implementation intent
- no duplicate source of truth is introduced
- terminology remains aligned with playbook / harness / run semantics

### Beta gate (M2)

The beta gate is defined in `docs/exec-plans/testing-and-evaluation-strategy.md`.

For any pull request to merge, CI must be green for the required lane: build + typecheck + test.

Documentation consistency remains a manual gate criterion alongside CI.

## Minimum quality bar for Phase 1 work

- core domain behavior is evaluable
- failure and blocker states are visible
- approvals and artifacts are not hidden side effects
- operator-facing status is legible
- documentation stays in sync with actual decisions

## Quality anti-patterns

- implementing before defining evaluation targets
- passing tests while docs are stale
- introducing ambiguous terminology
- shipping behavior that cannot be explained through the official model
- letting runtime details leak into product truth

## Documentation consistency rule

If a change invalidates architecture, product behavior, quality, reliability, or security docs, those docs must be updated in the same iteration.

Unreconciled docs are a quality failure.
