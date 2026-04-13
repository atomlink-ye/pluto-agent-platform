# PLANS.md

## Purpose

This document defines how execution plans are written, maintained, and retired.

## What belongs in a plan

Plans belong in `docs/exec-plans/` and should capture:

- stage sequencing
- current execution scope
- risks and assumptions
- acceptance gates
- open questions
- status and next actions

## What does not belong in a plan

- enduring design principles
- product behavior that should live in specs
- architectural rules that should live in design docs or `ARCHITECTURE.md`

## Plan categories

- `active/` — current implementation plans
- `completed/` — archived completed plans
- `tech-debt-tracker.md` — persistent debt not tied to one active plan
- `testing-and-evaluation-strategy.md` — repository-level EDD workflow

## Plan writing rules

Every active plan should include:

1. purpose
2. scope
3. non-goals
4. sequence of work
5. evaluation gates
6. completion criteria

## Relationship to design and specs

- Design tells you **why** and the boundary you must respect
- Spec tells you **what** must be true
- Plan tells you **how and in what order** work should happen

If a plan needs to redefine product behavior, the spec is incomplete and must be updated first.
