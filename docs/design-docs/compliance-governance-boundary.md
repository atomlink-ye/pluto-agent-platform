# Compliance and Governance Boundary

Pluto's governance and compliance model is playbook-first: governed execution
starts from Agent, Playbook, Scenario, and RunProfile, then produces a Run and
an EvidencePacket. The EvidencePacket is the audit lineage signal consumed by
Document, Version, Review, Approval, PublishPackage, compliance, and audit
export surfaces. Runtime internals and raw provider payloads remain backstage,
and the current local skeleton does not claim production compliance readiness.

Canonical reference: `docs/design-docs/agent-playbook-scenario-runprofile.md`.
PM Space context: [Core Object Model](https://ocnb314kma1f.feishu.cn/wiki/E2Itw8ERliNZOpkw4fTcIjA5nAf),
[Run, Audit Middleware & Evidence Packet Model](https://ocnb314kma1f.feishu.cn/wiki/V4mcwu6DmiYim1kEhI2cd8G3nMb),
[Identity, Access, RBAC & Multi-tenant Boundary](https://ocnb314kma1f.feishu.cn/wiki/GFM6waZPtiLrJ9kQJHLcQAiDnVe),
[Security, Privacy & Scoped Tool Gateway](https://ocnb314kma1f.feishu.cn/wiki/WSgwwvjSUiTquykyFgzcn6Gcnkw),
and [Compliance & Regulatory Controls](https://ocnb314kma1f.feishu.cn/wiki/RO0PwjJlLiwLRokB6dJcxEhanrf).

## Governance chain

The core governance chain is:

```text
Playbook -> Scenario -> RunProfile -> Run -> EvidencePacket -> Document / Review / Approval / PublishPackage
```

- **Playbook:** governed workflow composition and natural-language workflow
  narrative, plus minimal audit side-data such as required roles and revision
  cap.
- **Scenario:** business specialization, fixed or templated task, role overlays,
  knowledge references, and evaluator rubric.
- **RunProfile:** operational policy: workspace, worktree, required reads,
  acceptance commands, artifact contract, stdout contract, approval gates,
  concurrency, and secrets redaction.
- **Run:** observable execution attempt for the resolved four-layer stack.
- **EvidencePacket:** sealed audit lineage for the Run, including events, file
  checkpoints, stdout matches, command results, revision summary, redaction
  summary, status, and downstream refs.
- **Document / Version:** downstream content objects that may consume artifacts
  and attach EvidencePackets by `evidence_packet_id`.
- **Review:** quality or suitability decision that cites the EvidencePacket it
  considered.
- **Approval:** explicit authorization, distinct from Review, inheriting the
  EvidencePacket basis where policy requires evidence.
- **PublishPackage:** governed delivery object containing Version refs,
  approval refs, EvidencePacket refs, readiness refs, channel targets, export
  assets, publish attempts, and audit events.

Decisions should target a Version, section reference, PublishPackage, or
EvidencePacket ref rather than a mutable draft, raw artifact, raw log, or
provider session.

## Compliance controls

Compliance controls attach to governed objects and their evidence chain.

- **Retention policy:** records retention class, governed refs, effective time,
  retain-until value, and summary. The local skeleton validates shape;
  production must enforce retention in storage and deletion paths.
- **Legal hold:** records placed/released state, governed refs, release review
  or approval refs, reason, and summary. A placed hold must block hard delete.
- **Deletion decision:** records deletion attempt, target, requester, mode,
  outcome, block reason, evidence refs, and summary.
- **Audit export:** assembles governed object chains, EvidencePacket refs,
  compliance event refs, retention and hold summaries, checksums, recipient
  metadata, and a signature or seal record.
- **Regulated publish gate:** blocks regulated publishing unless explicit
  compliance evidence and required review or approval decisions are present.

These controls are governance records first. Production storage, authorization,
retention engines, signing, and delivery mechanisms must enforce them; they are
not fully enforced by local JSON files alone.

## Identity and security boundary

The identity boundary starts at Workspace scope and applies to the four
foreground layers, Run, and EvidencePacket. Downstream Document, Review,
Approval, PublishPackage, compliance, and export scopes inherit from that
governed execution and evidence lineage.

- **Workspace principal:** the resolved actor, service account, or token context
  performing an action in a workspace.
- **Role:** additive eligibility such as viewer, editor, reviewer, approver,
  publisher, run operator, playbook author, scenario author, RunProfile owner,
  or admin. Admin does not automatically mean approver or publisher.
- **Permit:** a scoped authorization decision for privileged action such as
  authoring or modifying Agent/Playbook/Scenario/RunProfile YAML, launching a
  Run, sealing an EvidencePacket, making a review decision, making an approval
  decision, attempting publish, releasing legal hold, deleting, exporting, or
  writing outbound data.
- **Secret ref:** a reference to a secret or environment value. Secret values
  must not be serialized into authored layers, prompts, governed records,
  EvidencePackets, PublishPackages, exports, portability bundles, or audit
  summaries.
- **Outbound approval:** external writes and connector-assisted publishing need
  explicit authority, scoped provider configuration, redacted payload summaries,
  idempotency, and auditable results.

Every privileged path must preserve actor attribution and deny cross-workspace
access unless a future explicit sharing object grants it. Runtime adapters and
provider sessions remain backstage; RBAC should authorize the Pluto action, not
grant users uncontrolled access to raw provider state.

## Fail-closed requirements

The following must fail closed:

- workspace mismatch or suspended workspace;
- revoked principal, token, service account, membership, or binding;
- missing role eligibility for Agent, Playbook, Scenario, RunProfile, Run,
  EvidencePacket, review, approval, publish, export, legal-hold release,
  deletion, schedule execution, or outbound write;
- pre-launch manual gate denied or missing;
- missing or unreachable required reads;
- `knowledge_refs` overflow beyond max 3 refs, 8k total tokens, or 4k tokens per
  ref;
- missing required artifact file or required section;
- missing stdout line or regex required by `stdout_contract`;
- missing `STAGE` or `DEVIATION` event citation in the final report;
- missing required role citation from `Playbook.audit.required_roles`;
- revision loop exceeding `Playbook.audit.max_revision_cycles`;
- failed acceptance command unless explicitly marked `blocker_ok`;
- missing sealed evidence where policy requires evidence;
- unredacted, mutable, or invalid EvidencePacket;
- missing approval for publish readiness or legal-hold release;
- regulated publish without compliance evidence;
- legal hold on a hard-delete target;
- retention window that has not expired;
- unresolved secret refs or attempted secret value serialization;
- runtime capability mismatch or disabled provider profile;
- duplicate idempotency key for publish or external write.

Audit middleware is fail-closed: file checkpoints, stdout matches, events,
acceptance commands, final-report sections, required role citations, redaction,
and revision cap must all validate before evidence is decision-grade. A team
lead's final success claim cannot override missing contracted evidence.

Fail-closed behavior should create diagnosable records: blocker reasons,
readiness blocked reasons, deletion logs, compliance action events, audit
envelopes, or redacted observability summaries.

## Current local validation vs production enforcement

The current local implementation validates important product semantics:

- shape of Agent, Playbook, Scenario, RunProfile, Run, EvidencePacket, review,
  approval, publish, compliance, observability, and evidence records;
- separation between artifact, EvidencePacket, and governed PublishPackage;
- evidence generation, redaction, validation, blocker classification, and
  audit-middleware contract behavior;
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
Agent, Playbook, Scenario, RunProfile, templates, publish package summaries,
EvidencePacket summaries, checksums, compatibility metadata, and import
requirements. They must exclude tenant-private state, raw provider sessions,
raw payloads, credentials, private storage paths, workspace bindings, and
unredacted runtime diagnostics. PM Space: [Portability Beyond Workflow](https://ocnb314kma1f.feishu.cn/wiki/XlavwwfW9i6kAFk3RGCcM3dQnyf).

Audit exports are compliance artifacts. They may include governed object
chains, EvidencePacket refs, review and approval refs, PublishPackage refs,
retention and hold summaries, deletion logs, compliance events, checksums, and
signature or seal metadata. Audit exports should preserve integrity and
reconstructability without exposing secrets or raw provider payloads.

Both boundaries depend on redaction and immutable evidence. If an export cannot
prove what was included, what was redacted, which Run produced the evidence,
and which governed decisions it represents, it should not be treated as
decision-grade.
