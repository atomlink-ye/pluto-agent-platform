# Playbook Contract

## Purpose

Define the canonical structural contract for `Playbook`.

Playbook stays intentionally lightweight. It defines task semantics, not platform governance.

## Canonical shape

```yaml
kind: playbook
name: sprint-retro-facilitator
description: Prepare a sprint retrospective draft from issue and chat signals
owner: eng-productivity
version: 1

inputs: []
goal: ""
instructions: ""

context: {}
tools: []
skills: []
team: {}
artifacts: []
quality_bar: []
metadata: {}
```

## Top-level fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `kind` | yes | literal | must be `playbook` |
| `name` | yes | string | stable slug-like identifier |
| `description` | yes | string | short human-readable summary |
| `owner` | no | string | team or business owner |
| `version` | no | string\|number | template revision marker |
| `inputs` | no | `InputSpec[]` | dynamic run inputs |
| `goal` | yes | string | high-level task goal |
| `instructions` | yes | string | suggested execution guidance |
| `context` | no | `PlaybookContext` | systems and references required |
| `tools` | no | `string[]` | required or preferred capabilities |
| `skills` | no | `string[]` | preferred higher-level skills or bundles |
| `team` | no | `TeamPreference` | preferred role or team hints |
| `artifacts` | no | `ArtifactExpectation[]` | expected outputs |
| `quality_bar` | no | `string[]` | explicit quality expectations |
| `metadata` | no | object | extension area |

## Nested contracts

### `InputSpec`

```yaml
- name: sprint_id
  type: string
  required: true
  description: Sprint identifier to analyze
  default: null
  enum: null
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `name` | yes | string | unique within the playbook |
| `type` | yes | string | recommended: `string`, `number`, `boolean`, `object`, `array` |
| `required` | yes | boolean | whether caller must provide it |
| `description` | no | string | human-readable meaning |
| `default` | no | unknown | optional default value |
| `enum` | no | unknown[] | optional explicit choices |

### `PlaybookContext`

```yaml
context:
  mcp_servers:
    - linear
    - slack
  repositories:
    - monorepo-main
  memory_packs:
    - retro-guidelines
```

Supported keys may expand, but these are the current canonical ones:

- `mcp_servers: string[]`
- `repositories: string[]`
- `memory_packs: string[]`

### `ArtifactExpectation`

```yaml
- type: retro_doc
  format: markdown_or_docx
  description: Final retro document
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `type` | yes | string | stable output type |
| `format` | no | string | expected output format |
| `description` | no | string | human-readable purpose |

### `TeamPreference`

```yaml
team:
  lead_role: analyst
  preferred_roles:
    - researcher
    - analyst
    - writer
  coordination_mode: supervisor-led
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `lead_role` | no | string | preferred lead role |
| `preferred_roles` | no | string[] | suggested role set |
| `coordination_mode` | no | string | preferred orchestration mode |

## Contract rules

- Playbook must not define approval policy, retries, or timeout rules
- Playbook may suggest roles, but must not fully hardcode team execution
- Playbook should remain reusable across Harness, EnvironmentSpec, and Team configurations
