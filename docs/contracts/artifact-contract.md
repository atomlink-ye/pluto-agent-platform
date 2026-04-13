# Artifact Contract

## Purpose

Define the canonical structural contract for artifacts.

Artifacts are formal outputs of governed execution. Payload location may vary, but identity and metadata must remain durable product-layer records.

## Canonical shape

```yaml
kind: artifact
id: art_001
run_id: run_123
type: retro_doc
title: Sprint Retro Draft
format: markdown
producer:
  role_id: writer
  session_id: sess_002
storage:
  kind: file
  uri: file:///workspace/docs/retro.md
status: registered
metadata: {}
```

## Top-level fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `kind` | yes | literal | must be `artifact` |
| `id` | yes | string | stable artifact identifier |
| `run_id` | yes | string | owning run |
| `type` | yes | string | stable artifact type |
| `title` | no | string | human-readable display name |
| `format` | no | string | markdown, docx, patch, json, etc. |
| `producer` | no | object | origin role/session context |
| `storage` | no | object | storage pointer, not payload authority |
| `status` | yes | `ArtifactStatus` | lifecycle state |
| `metadata` | no | object | extension area |

## `ArtifactStatus`

- `draft`
- `created`
- `registered`
- `superseded`
- `archived`

## `producer`

```yaml
producer:
  role_id: writer
  session_id: sess_002
```

## `storage`

```yaml
storage:
  kind: file
  uri: file:///workspace/docs/retro.md
```

Supported `storage.kind` values may include:

- `file`
- `object_store`
- `inline`

## Contract rules

- artifact identity, lineage, and run linkage are durable contracts
- artifact payload may live outside Postgres, but artifact metadata must not
- registered artifacts should be queryable from run detail and artifact-focused operator views
