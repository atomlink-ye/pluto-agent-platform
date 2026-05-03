# docs/plans/README.md — Pluto Plans

This directory holds active and completed work plans for Pluto.

## Purpose

- Preserve durable work state from `.local/manager` records.
- Make active follow-up plans explicit and visible.
- Archive completed iteration records without copying external repository content.

## Lifecycle

- For non-trivial planned work, create or update a plan in `docs/plans/active/` before implementation.
- Active plans are living records. Keep scope, status, blockers, verification target, and follow-up current as the work changes.
- When work is completed and verified, move the plan file to `docs/plans/completed/`.
- Completed plans must include verification/evidence summary and any remaining follow-up.
- Do not leave stale active plans for work that has already been accepted or completed.

Trivial/local edits do not need a plan record.

## Docs-Consistency Gate

Every evaluation, checklist, review, or acceptance pass must check repository-documentation consistency. Code, contracts, CLI behavior, docs/plans, design docs, and reference docs must not contradict each other. If implementation changed behavior, contracts, workflows, or product shape and affected docs were not updated, evaluation must fail or mark the work blocked.

## Format

Each plan is a markdown file. Use this template:

```markdown
# Plan: <title>

## Goal
<One sentence>

## Scope
- Included
- Excluded

## Status
- [ ] Not started
- [ ] In progress
- [ ] Blocked
- [ ] Complete

## Tasks
1. <task>
2. <task>

## Dependencies
- <depends on>

## Notes
<Misc>
```

## Active Plans

- `active/full-product-shape-hardening.md` — post-PRODUCT_COMPLETE hardening and cleanup.

## Completed Plans

- `completed/slice-3-hardening.md`
- `completed/wave-a-governance-portability-catalog-spec-hygiene.md`
- `completed/wave-b-review-publish-identity-security-storage.md`
- `completed/wave-cd-schedule-observability-compliance-bootstrap.md`
- `completed/product-complete-final-check.md`
- `completed/agent-teams-chat-mailbox-runtime.md` — Agent Teams chat-backed mailbox runtime (S1-S6 + integration `pluto/agent-teams-chat-mailbox-runtime-integrated` HEAD `72bcef2`); ready for user merge.

Completed plans are stored in `docs/plans/completed/` with verification/evidence notes and remaining follow-up.

## Related

- `docs/debt/README.md` — Technical debt tracking
- `docs/mvp-alpha.md` — MVP object contracts
