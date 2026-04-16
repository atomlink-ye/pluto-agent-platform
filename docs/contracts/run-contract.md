# Run Contract

## Purpose

Define the canonical structural contracts for `Run`, `RunPlan`, `EnvironmentSpec`, `RunSession`, and `PolicySnapshot`.

## Run

### Canonical shape

```yaml
kind: run
id: run_123
playbook: sprint-retro-facilitator
harness: standard-research-and-draft
environment: env_default
team: sprint-retro-team

input:
  sprint_id: SPR-42
  slack_channel: team-eng

status: running
current_phase: analyze
```

### Top-level fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `kind` | yes | literal | must be `run` |
| `id` | yes | string | stable run identifier |
| `playbook` | yes | string | playbook reference |
| `harness` | yes | string | harness reference |
| `environment` | no | string | EnvironmentSpec reference |
| `team` | no | string | TeamSpec reference or resolved team config |
| `input` | yes | object | concrete run inputs |
| `status` | yes | `RunStatus` | current run state |
| `current_phase` | no | string | active phase |
| `failureReason` | no | string | reason when status is `failed` |
| `blockerReason` | no | string | reason when status is `blocked` |

### `RunStatus`

Canonical normalized run states:

- `queued`
- `initializing`
- `running`
- `blocked`
- `waiting_approval`
- `failing`
- `failed`
- `succeeded`
- `canceled`
- `archived`

## RunPlan

### Canonical shape

```yaml
kind: run_plan
run_id: run_123
current_phase: analyze

stages:
  - id: collect_linear
    phase: collect
    role: researcher
    status: completed
  - id: draft_document
    phase: draft
    role: writer
    status: pending
```

### Stage shape

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | string | unique within the run plan |
| `phase` | yes | string | phase bucket from harness |
| `role` | no | string | assigned role |
| `status` | yes | `StageStatus` | stage state |

### `StageStatus`

- `pending`
- `running`
- `completed`
- `blocked`
- `failed`
- `skipped`

## EnvironmentSpec

### Canonical shape

```yaml
kind: environment
id: env_default
name: Default Workspace Environment
repositories:
  - monorepo-main
integrations:
  - linear
  - slack
constraints: {}
metadata: {}
```

### Top-level fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `kind` | yes | literal | currently `environment` |
| `id` | yes | string | stable identifier |
| `name` | yes | string | human-readable name |
| `repositories` | no | string[] | declared repo or workspace scope |
| `integrations` | no | string[] | external systems expected |
| `constraints` | no | object | execution constraints |
| `metadata` | no | object | extension area |

## RunSession

### Canonical shape

```yaml
kind: run_session
id: rs_001
run_id: run_123
session_id: sess_001
persistence_handle: provider_session_001
role_id: analyst
provider: claude
mode_id: default
status: active
```

### Top-level fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `kind` | yes | literal | must be `run_session` |
| `id` | yes | string | stable run-session record id |
| `run_id` | yes | string | owning run |
| `session_id` | yes | string | runtime session handle |
| `persistence_handle` | no | string | provider session id used for resume/recovery when available |
| `role_id` | no | string | assigned role |
| `provider` | no | string | runtime provider |
| `mode_id` | no | string | provider mode or preset |
| `status` | yes | string | see RunSession status values below |

### RunSession status values

**Current production values:**

| Value | Meaning |
|---|---|
| `active` | Session is live and bound to a runtime agent |
| `failed` | Session recovery failed; session is unrecoverable |

These are the only two values written by production code today.

**Planned (not yet implemented):**

| Value | Meaning | Status |
|---|---|---|
| `interrupted` | Session was interrupted by runtime failure | planned |
| `resumed` | Session was resumed after interruption | planned |
| `closed` | Session completed normally | planned |

**Known debt:** `RunSession.status` is typed as `string` in contracts, not a union type or enum. This allows any value to be stored without validation. Constraining the type is deferred to a future contract-tightening issue.

## PolicySnapshot

### Canonical shape

```yaml
kind: policy_snapshot
run_id: run_123
approvals:
  destructive_write: required
  external_publish: required
timeouts:
  total_minutes: 20
requirements:
  artifact_registration_required: true
```

### Purpose

PolicySnapshot captures the effective governed policy applied to a specific run after combining harness defaults and higher-level overlays.

## Known compatibility debt — UI status aliases

The operator UI accepts and normalizes several status aliases that diverge from canonical contract values. These are compatibility shims, not canonical vocabulary.

| UI alias | Canonical value | Context |
|---|---|---|
| `pending_approval` | `waiting_approval` | Both accepted in filter and display; UI shows "pending approval" for either |
| `cancelled` (double-L) | `canceled` (single-L) | UI accepts both; displays "cancelled" regardless of stored spelling |
| `running` (session) | `active` | `RunDetailPage` checks for both `running` and `active` when selecting the default session |

These aliases exist in `Badge.tsx` (label overrides and style mapping), `RunListPage.tsx` (filter matching), and `RunDetailPage.tsx` (session lookup). They are not part of the canonical contract and should be consolidated in a future UI normalization pass.

## Contract rules

- Run is the primary business object
- RunPlan is a compiled view, not a hand-authored static graph
- EnvironmentSpec stays durable and explicit rather than implicit
- RunSession preserves runtime linkage without making runtime state authoritative
- PolicySnapshot preserves the actual governed boundary used for one run
