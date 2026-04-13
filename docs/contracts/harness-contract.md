# Harness Contract

## Purpose

Define the canonical structural contract for `Harness`.

Harness defines deterministic execution governance. It does not define the business task itself.

## Canonical shape

```yaml
kind: harness
name: standard-research-draft-review
description: Standard research, draft, review, finalize governance skeleton
version: 1

phases: []
status_model: {}
timeouts: {}
retries: {}
approvals: {}
requirements: {}
observability: {}
escalation: {}
metadata: {}
```

## Top-level fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `kind` | yes | literal | must be `harness` |
| `name` | yes | string | stable reusable identifier |
| `description` | yes | string | human-readable purpose |
| `version` | no | string\|number | governance revision marker |
| `phases` | yes | string[] | stable phase skeleton |
| `status_model` | no | `StatusModel` | normalized run and stage states |
| `timeouts` | no | `TimeoutPolicy` | run and session timing rules |
| `retries` | no | `RetryPolicy` | retry-by-action-class rules |
| `approvals` | no | `ApprovalPolicy` | approval requirements by action class |
| `requirements` | no | `RequirementPolicy` | evidence and artifact obligations |
| `observability` | no | `ObservabilityPolicy` | event and tracking obligations |
| `escalation` | no | object | escalation and notification rules |
| `metadata` | no | object | extension area |

## Nested contracts

### `StatusModel`

```yaml
status_model:
  run:
    - queued
    - initializing
    - running
    - blocked
    - waiting_approval
    - failing
    - failed
    - succeeded
    - canceled
    - archived
  stage:
    - pending
    - running
    - completed
    - blocked
    - failed
    - skipped
```

### `TimeoutPolicy`

```yaml
timeouts:
  total_minutes: 20
  per_phase:
    collect: 8
    analyze: 5
  session_idle_minutes: 10
  approval_wait_minutes: 120
```

### `RetryPolicy`

```yaml
retries:
  fetch:
    max_attempts: 2
    backoff: exponential
  write:
    max_attempts: 1
    backoff: none
```

### `ApprovalPolicy`

```yaml
approvals:
  destructive_write: required
  external_publish: required
  network_access: optional
  pr_creation: required
```

Recommended values:

- `required`
- `optional`
- `disabled`
- `inherit`

### `RequirementPolicy`

```yaml
requirements:
  evidence_links_required: true
  artifact_registration_required: true
  final_summary_required: true
  review_before_publish: true
  role_handoff_tracking_required: true
```

### `ObservabilityPolicy`

```yaml
observability:
  event_log_required: true
  stage_transitions_required: true
  artifact_emission_required: true
  role_activity_tracking: true
  raw_tool_events_retention_days: 30
```

## Contract rules

- Harness defines governance, not business intent
- Harness constrains execution without requiring a static DAG
- Harness may be further refined by higher-level policy overlays
