# Local File-backed Architecture

The current Pluto implementation is a local-first, file-backed product skeleton.

## What the local skeleton proves

- The four authored layers can be loaded, validated, and rendered locally.
- The v1.6 runtime can persist mailbox and task-list coordination as local files.
- Audit and evidence generation can be validated without external control-plane storage.
- Downstream governance can attach to sealed evidence rather than raw runtime state.

## File-backed runtime surfaces

- `.pluto/runs/<runId>/mailbox.jsonl` — mirrored mailbox log
- `.pluto/runs/<runId>/tasks.json` — shared task list
- `.pluto/runs/<runId>/artifact.md` — final artifact
- `.pluto/runs/<runId>/evidence-packet.{md,json}` — canonical evidence outputs

These are the file-backed implementations of the mailbox + task-list runtime, not a
separate fallback model.

## What it does not prove

- Production-grade tenant isolation or authorization.
- Queueing, hosted retries, retention, legal hold, or disaster recovery.
- Multi-user collaboration under real latency and failure modes.

## Production changes required

Before Pluto becomes production multi-user software, the file-backed stores must be
wrapped or replaced with transactional persistence, queueing, observability, secret
resolution, and retention controls.

The conceptual model should stay playbook-first and governance-first throughout that
transition.
