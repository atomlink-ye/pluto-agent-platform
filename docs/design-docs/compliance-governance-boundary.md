# Compliance and Governance Boundary

Pluto's governance and compliance model is intended to make AI-assisted work
auditable without claiming that the current local skeleton is production-ready.
The product boundary is the governed object chain: content, decisions, evidence,
publishing, and compliance controls. Runtime internals and raw provider payloads
remain backstage.

## Governance chain

The core governance chain is:

```text
Document -> Version -> Review -> Approval -> Publish Package
```

- **Document:** primary content object inside a Workspace.
- **Version:** stable decision target for review, approval, evidence, and
  publishing.
- **Review:** quality or suitability decision, including comments, changes
  requested, pass/fail state, evidence requirements, diff snapshot, and SLA or
  delegation overlays where used.
- **Approval:** explicit authorization by eligible approvers. Approval is not the
  same as Review and should not be implied by admin assignment.
- **Publish Package:** governed delivery object containing source Versions,
  approval refs, sealed evidence refs, release readiness refs, channel targets,
  export assets, publish attempts, rollback/retract/supersede records, and audit
  events.

Decisions should target a Version, section reference, or Publish Package rather
than a mutable draft, raw artifact, or provider session.

## Compliance controls

Compliance controls attach to governed objects and their evidence chain.

- **Retention policy:** records retention class, governed refs, effective time,
  retain-until value, and summary. The local skeleton validates shape; production
  must enforce retention in storage and deletion paths.
- **Legal hold:** records placed/released state, governed refs, release review or
  approval refs, reason, and summary. A placed hold must block hard delete.
- **Deletion decision:** records deletion attempt, target, requester, mode,
  outcome, block reason, evidence refs, and summary.
- **Audit export:** assembles governed object chains, evidence refs, compliance
  event refs, retention and hold summaries, checksums, recipient metadata, and a
  signature or seal record.
- **Regulated publish gate:** blocks regulated publishing unless explicit
  compliance evidence and required review or approval decisions are present.

These controls are governance records first. Production storage, authorization,
retention engines, signing, and delivery mechanisms must enforce them; they are
not fully enforced by local JSON files alone.

## Identity and security boundary

The identity boundary starts at Workspace scope.

- **Workspace principal:** the resolved actor, service account, or token context
  performing an action in a workspace.
- **Role:** additive eligibility such as viewer, editor, reviewer, approver,
  publisher, or admin. Admin does not automatically mean approver or publisher.
- **Permit:** a scoped authorization decision for a privileged action such as
  review decision, approval decision, run trigger, publish attempt, legal-hold
  release, deletion, export, or outbound write.
- **Secret ref:** a reference to a secret or environment value. Secret values
  must not be serialized into governed records, evidence packets, publish
  packages, exports, portability bundles, or audit summaries.
- **Outbound approval:** external writes and connector-assisted publishing need
  explicit authority, scoped provider configuration, redacted payload summaries,
  idempotency, and auditable results.

Every privileged path must preserve actor attribution and deny cross-workspace
access unless a future explicit sharing object grants it.

## Fail-closed requirements

The following must fail closed:

- workspace mismatch or suspended workspace;
- revoked principal, token, service account, membership, or binding;
- missing role eligibility for review, approval, publish, export, legal-hold
  release, deletion, schedule execution, or outbound write;
- missing sealed evidence where policy requires evidence;
- unredacted or invalid evidence packet;
- missing approval for publish readiness or legal-hold release;
- regulated publish without compliance evidence;
- legal hold on a hard-delete target;
- retention window that has not expired;
- unresolved secret refs or attempted secret value serialization;
- runtime capability mismatch or disabled provider profile;
- duplicate idempotency key for publish or external write.

Fail-closed behavior should create diagnosable records: blocker reasons,
readiness blocked reasons, deletion logs, compliance action events, audit
envelopes, or redacted observability summaries.

## Current local validation vs production enforcement

The current local implementation validates important product semantics:

- object shapes for review, approval, publish, compliance, observability, and
  evidence records;
- separation between artifact, evidence packet, and governed publish package;
- evidence generation, redaction, validation, blocker classification, retry
  provenance, and underdispatch fallback records;
- credential leakage checks in publish payload summaries;
- regulated publish gate shape and missing-compliance-evidence blocking;
- local audit, budget, run health, and adapter health record shapes.

It does not prove production enforcement of:

- multi-tenant storage isolation and authorization on every read and write;
- transactional persistence, migrations, concurrent write safety, and durable
  background queues;
- hosted secret management, key rotation, signing, and delivery infrastructure;
- legal-grade retention, legal hold, deletion, audit export, and backup/restore;
- webhook replay protection, connector trust boundaries, and external publish
  rollback guarantees;
- centralized monitoring, alerting, incident response, or disaster recovery.

The local skeleton is therefore a product-shape and contract validation vehicle,
not a production compliance system.

## Portability, export, and audit integrity

Portability and audit export have different boundaries.

Portability bundles should include safe, portable definitions and summaries:
documents, templates, portable workflow definitions, publish package summaries,
evidence summaries, checksums, compatibility metadata, and import requirements.
They must exclude tenant-private state, raw provider sessions, raw payloads,
credentials, private storage paths, workspace bindings, and unredacted runtime
diagnostics.

Audit exports are compliance artifacts. They may include governed object chains,
sealed evidence refs, review and approval refs, publish package refs, retention
and hold summaries, deletion logs, compliance events, checksums, and signature or
seal metadata. Audit exports should preserve integrity and reconstructability
without exposing secrets or raw provider payloads.

Both boundaries depend on redaction and immutable evidence. If an export cannot
prove what was included, what was redacted, and which governed decisions it
represents, it should not be treated as decision-grade.
