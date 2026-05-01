# Local File-backed Architecture

The current Pluto implementation is a local-first, file-backed product skeleton.
Its purpose is to validate object shape, orchestration semantics, evidence
boundaries, and CLI workflows before production persistence exists.

## What the local skeleton proves

- Core contracts are concrete enough to serialize, validate, list, and inspect.
- Governance objects can refer to Documents, Versions, Reviews, Approvals,
  Publish Packages, Playbooks, Scenarios, and Schedules.
- Team runs can dispatch lead and worker roles, collect contributions, create
  artifacts, classify blockers, retry bounded failures, and write evidence.
- Catalog and extension records can pin reusable capability versions and preserve
  provenance in worker contributions.
- Integration, schedule, publish, portability, compliance, observability, and
  identity/security contracts can be exercised without external infrastructure.

## What it does not prove

- Production-grade tenant isolation or cross-workspace authorization.
- Concurrent write safety, transactional consistency, or migration behavior.
- Durable background queues, cron dispatch, webhook delivery, or retry workers.
- Hosted secret resolution, key management, or provider credential injection.
- Centralized observability, retention/legal hold, backup/restore, or disaster
  recovery.
- Multi-user collaboration behavior under real latency and failure modes.

## Production changes required

Before Pluto is production multi-user software, local JSON/file stores must be
replaced or wrapped with:

1. A transactional persistence layer with schema migrations and compatibility
   gates.
2. Tenant-aware authorization enforcement on every read, write, dispatch, import,
   export, publish, and integration path.
3. Durable queues for runs, schedules, webhook processing, publish attempts,
   retries, and cleanup jobs.
4. Webhook/event infrastructure with signing, idempotency, replay protection,
   delivery backoff, and dead-letter handling.
5. Secret and environment reference resolution that never serializes secret
   values into governed records or portability bundles.
6. Observability storage for audit, metrics, budgets, adapter health, evidence
   readiness, and operational alerts.
7. Retention, deletion, legal hold, export, backup, restore, and rollback
   controls that preserve sealed evidence and audit integrity.

The conceptual model should stay document-first and governance-first throughout
that transition. Persistence changes should not promote raw runtime sessions,
provider logs, or storage paths into foreground product objects.
