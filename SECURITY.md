# SECURITY.md

## Purpose

This document defines security boundaries and forbidden patterns.

## Security stance

The platform adds governance on top of a coding-agent runtime substrate. That means approval, capability boundaries, and durable auditability matter as much as raw execution power.

## Security rules

### 1. High-risk actions require explicit governance

Potentially destructive or externally impactful actions should be governable through policy and approval paths.

At minimum, Phase 1 should treat the following as protected action classes when they are present:

- destructive writes
- external publishing or notification actions
- sensitive external tool or MCP side effects
- repository mutation with meaningful external impact

### 2. Durable business state must not be hidden in local runtime files

Business-critical state belongs in Postgres and in governed product-layer records, not in opaque local runtime caches.

### 3. Artifact metadata must be explicit

Artifact identity, producer, lineage, and access-relevant metadata should be durable and queryable.

### 4. Runtime integration must respect product-layer authority

Provider-specific behavior may drive execution, but it must not silently redefine product rules.

## Handling constraints

- do not commit secrets into repository docs or examples
- do not treat local runtime persistence as audited truth
- do not allow approvals to exist only as UI state
- do not blur operator actions and agent actions in audit-relevant records

## Phase 1 non-goals

This document does not claim Phase 1 will deliver full enterprise security coverage such as deep RBAC or hardened multi-tenant isolation. Those must be treated as future work until explicitly specified.
