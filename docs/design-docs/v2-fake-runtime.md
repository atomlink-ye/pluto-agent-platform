# v2 Fake Runtime

## Scope

S4 adds a deterministic fake runtime around the v2 core. This document records the Lane B
translation and evidence rules that parity tests must enforce.

## Legacy Translation

`packages/pluto-v2-runtime/src/legacy/v1-translator.ts` converts legacy v1.6 `events.jsonl`
 rows into v2 `RunEvent` values.

- The translator is pure and does not perform I/O.
- The legacy event grammar is closed. All 20 table-A rows are handled explicitly.
- Unknown legacy `type` values throw.
- Legacy mailbox `payload.kind` uses table B filtering.
- Unknown legacy mailbox kinds are silently dropped.
- Dropped mailbox kinds do not produce v2 events.
- Emitted v2 envelopes preserve legacy ordering through a dense `sequence` counter over emitted rows.
- `run_started` maps to a system event with `requestId: null`.
- `run_completed` synthesizes `status: 'succeeded'`, `summary: null`, and `completedAt` from the legacy envelope timestamp.
- `task_claimed` infers `queued -> running`.
- `task_completed` infers `running -> completed`.
- `artifact_created` maps to `artifact_published` with `kind: 'final'`, `mediaType: 'text/markdown'`, and `byteSize: 0`.

### Deterministic IDs

The translator derives v2 identifiers with UUIDv5 using namespace
`6ba7b810-9dad-11d1-80b4-00c04fd430c8` and the legacy `eventId` as the seed input.

- `eventId` uses the `event:` name prefix.
- `requestId` uses the `request:` name prefix for accepted request-backed events.
- `artifactId` uses the `artifact:` name prefix for translated `artifact_created` rows.

This keeps translation replayable without ambient randomness.

## Evidence Packet

`packages/pluto-v2-runtime/src/evidence/evidence-packet.ts` assembles the S4 v2 evidence packet.

- Output shape matches table D exactly.
- `schemaVersion` is fixed to `'1.0'`.
- `kind` is fixed to `'evidence_packet'`.
- `status` is `views.evidence.run.status` when present, otherwise `'in_progress'`.
- `summary`, `startedAt`, and `completedAt` come from the evidence projection run view and fall back to `null`.
- `citations[].text` comes from `EvidenceProjectionView.view.citations[].summary`.
- `citations[].observedAt` is recovered from the matching source event timestamp.
- `mailboxMessages` come from the mailbox projection and omit projection-only `eventId`.
- `artifacts` are assembled by filtering the full event stream for `artifact_published` because `replayAll` has no artifact projection.

## Boundaries

- No filesystem or YAML imports appear in the translator or evidence modules.
- No ambient time or randomness is used.
- Lane B does not mutate loader, fake adapter, runner, or v2 core files.
