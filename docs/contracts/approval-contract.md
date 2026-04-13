# Approval Contract

## Purpose

Define the canonical structural contract for approval objects and approval action classes.

Approvals are first-class governed objects, not ephemeral UI prompts.

## Approval action classes

Phase 1 canonical action classes:

- `destructive_write`
- `external_publish`
- `sensitive_mcp_access`
- `pr_creation`
- `production_change`

Additional action classes may be added later, but these should anchor the minimum stable core.

## Canonical shape

```yaml
kind: approval
id: appr_001
run_id: run_123
action_class: destructive_write
title: Confirm destructive repository write
status: pending
requested_by:
  source: policy
  session_id: sess_001
  role_id: implementer
context:
  phase: execute
  stage_id: apply_patch
  reason: Requested action changes repository state in a destructive way
resolution: null
metadata: {}
```

## Top-level fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `kind` | yes | literal | must be `approval` |
| `id` | yes | string | stable approval identifier |
| `run_id` | yes | string | owning run |
| `action_class` | yes | string | one canonical approval action class |
| `title` | yes | string | human-readable request title |
| `status` | yes | `ApprovalStatus` | current approval state |
| `requested_by` | yes | object | origin context |
| `context` | no | object | phase, stage, and reason context |
| `resolution` | no | object\|null | resolution details when decided |
| `metadata` | no | object | extension area |

## `ApprovalStatus`

- `pending`
- `approved`
- `denied`
- `expired`
- `canceled`

## `ApprovalDecision`

Subset of `ApprovalStatus` used for resolution decisions:

- `approved`
- `denied`

## `requested_by`

```yaml
requested_by:
  source: policy
  session_id: sess_001
  role_id: implementer
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `source` | yes | string | e.g. `policy`, `system`, `operator` |
| `session_id` | no | string | linked runtime session if any |
| `role_id` | no | string | linked role if any |

## `resolution`

```yaml
resolution:
  resolved_at: 2026-04-14T12:00:00Z
  resolved_by: operator_001
  decision: approved
  note: Safe to continue
```

## Contract rules

- approvals must be durably linked to a run
- approval resolution must be durable and auditable
- approval objects should be visible both from the run and from approval-focused operator views
