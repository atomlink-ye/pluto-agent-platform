# Role and Team Contract

## Purpose

Define the canonical structural contracts for reusable `RoleSpec` and `TeamSpec` objects.

## RoleSpec

### Canonical shape

```yaml
kind: role
id: reviewer
name: Reviewer
description: Reviews outputs for structure, completeness, and quality
system_prompt: ""
tools: []
provider_preset: null
memory_scope: project
isolation: shared
background: false
hooks: []
metadata: {}
```

### Top-level fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `kind` | yes | literal | must be `role` |
| `id` | yes | string | stable slug-like identifier |
| `name` | yes | string | UI-facing name |
| `description` | yes | string | responsibility summary |
| `system_prompt` | no | string | role-specific instruction body |
| `tools` | no | string[] | requested or allowed tools |
| `provider_preset` | no | string | provider/mode preset reference |
| `memory_scope` | no | string | `run`, `team`, `project`, `org` |
| `isolation` | no | string | `shared` or `worktree` |
| `background` | no | boolean | whether background execution is suitable |
| `hooks` | no | object[] | role-level hooks |
| `metadata` | no | object | extension area |

## TeamSpec

### Canonical shape

```yaml
kind: team
id: sprint-retro-team
name: Sprint Retro Team
description: Role set for preparing a sprint retrospective
lead_role: analyst
roles:
  - researcher
  - analyst
  - writer
  - reviewer
coordination:
  mode: supervisor-led
  shared_room: true
  heartbeat_minutes: 5
memory_scope: project
worktree_policy: per-run
metadata: {}
```

### Top-level fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `kind` | yes | literal | must be `team` |
| `id` | yes | string | stable team identifier |
| `name` | yes | string | UI-facing name |
| `description` | yes | string | what the team is suited for |
| `lead_role` | yes | string | required for the current V1 supervisor-led team mode |
| `roles` | yes | string[] | included role ids |
| `coordination` | no | `CoordinationPolicy` | orchestration defaults |
| `memory_scope` | no | string | default shared memory scope |
| `worktree_policy` | no | string | `shared`, `per-run`, or `per-role` |
| `metadata` | no | object | extension area |

## `CoordinationPolicy`

```yaml
coordination:
  mode: supervisor-led
  shared_room: true
  heartbeat_minutes: 5
```

Recommended `coordination.mode` values:

- `supervisor-led`
- `shared-room`
- `pipeline`
- `committee`

## Contract rules

- roles describe responsibilities, not fixed step numbers
- teams describe reusable collaboration structures, not static DAGs
- the current V1 team creation path requires `lead_role`, and `lead_role` must be included in `roles`
- governance such as approvals, retries, and artifact registration belongs to Harness or higher-level policy, not RoleSpec or TeamSpec
