# DESIGN.md — Pluto MVP-alpha Design Principles

## MVP Goal

Prove the smallest closed loop where Pluto, Paseo, and OpenCode cooperate to run an agent team led by a Team Lead.

## Design Principles

1. **Minimal closed loop:** Submit task → Team Lead → Workers → Artifact.
2. **Single adapter seam:** Runtime is pluggable, business logic is not.
3. **Host-driven live mode:** Paseo CLI is macOS-only, cannot run in Linux containers.
4. **Deterministic safety gates:** OPENCODE_BASE_URL is a guard, not a convenience.
5. **No DB:** State lives in files, not in databases.
6. **Artifact quality guard:** Live artifacts must not leak protocol fragments.

## Why Host-Driven Live Mode

The Paseo CLI is a macOS app bundle and cannot be installed inside a Linux Docker container. Therefore:

- **Host** owns the Paseo daemon and CLI.
- **OpenCode runtime** runs in an optional Docker container (useful for debugging web UI).
- Live smoke runs on host, not inside Docker.

This is a design constraint, not a temporary limitation.

## Why No-Endpoint Blocker

When `OPENCODE_BASE_URL` is unset and `PLUTO_LIVE_ADAPTER=paseo-opencode`, the smoke script short-circuits with exit code 2 **before** probing Paseo. This:

- Prevents accidental live runs without explicit endpoint declaration.
- Distinguishes "configuration missing" from "runtime failed."
- Provides structured blocker payload for automation.

## Why Legacy Product is Reference-Only

The `legacy` branch contains the prior implementation (UI, Postgres, multi-tenant control plane). It is:

- Frozen on a separate branch.
- Not merged into MVP-alpha.
- Referenced only for patterns (Docker compose, error handling).

MVP-alpha intentionally excludes: UI, DB, multi-tenant RBAC, marketplace, governance, playbook, harness governance.

## Tradeoffs

| What | MVP-alpha Tradeoff |
|------|-----------------|
| No UI | CLI-only task submission |
| No DB | File-based state (.pluto/runs/) |
| No multi-tenant | Single-tenant TeamRunService |
| No governance | Minimal acceptance gates |
| No marketplace | Single team (lead+3 workers) |
| No paid model | Free model only |
| Host-only live | Cannot run in container |

## Runtime Requirements

- **Node:** >=20.10
- **pnpm:** >=9
- **macOS (host):** for Paseo CLI
- **Docker:** optional for OpenCode runtime debugging