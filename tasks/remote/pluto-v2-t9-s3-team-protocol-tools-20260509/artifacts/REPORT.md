# T9-S3 Report

## Scope

Implemented the T9-S3 TeamProtocol composite tool slice on `pluto/v2/t9-s3-team-protocol-tools` without changing `packages/pluto-v2-core/**` or expanding the closed `RunEvent` set.

## Translation strategy

- `worker-complete` translates outside the kernel into:
  1. `change_task_state { taskId, to: completed }`
  2. `append_mailbox_message { toActor: role:lead, kind: completion, body }`
- `evaluator-verdict` translates outside the kernel into:
  1. `change_task_state { taskId, to: completed }` when `verdict=pass` and the evaluator-owned task is still open
  2. `append_mailbox_message { toActor: role:lead, kind, body }`
- `final-reconciliation` is a thin wrapper around `complete_run { status: succeeded, summary }`, where the summary stores a serialized structured payload containing `completedTasks`, `citedMessages`, and `summary`.

## Compatibility notes

- Primitive tools remain callable. The composite verbs are additive.
- Driver-synthesized task close-out remains in place for raw `append-mailbox-message kind=completion|final` flows.
- The evaluator `fail -> kind=rejected` shape from the task prompt is not representable without mutating the closed kernel mailbox kind enum. This slice preserves kernel immutability and uses existing mailbox kinds only.
- Negative evaluator verdicts use a non-closeout mailbox kind so they do not accidentally trigger the existing synthesized task close-out fallback.

## `final-reconciliation` vs `complete-run`

- `complete-run` is still the primitive mutation accepted by the kernel.
- `final-reconciliation` adds a higher-level lead-facing call shape with structured evidence references.
- In T9-S3, that structure is serialized into the terminal summary string.
- T10 can build on this by validating that cited message ids exist, that completed task ids are terminal, and that the cited evidence set is sufficient before allowing the wrapper to finalize the run.

## Verification target

- Runtime CLI exposes `worker-complete`, `evaluator-verdict`, and `final-reconciliation`.
- Local API exposes `/v2/composite/*` routes.
- Bootstrap prompts mention the canonical composite verbs for lead, generator, and evaluator.
- API and CLI tests cover the translation behavior and turn disposition handling.
