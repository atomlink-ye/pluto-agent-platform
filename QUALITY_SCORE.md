# QUALITY_SCORE.md — Pluto MVP-alpha Quality Dimensions

## Quality Dimensions

| Dimension | What it measures | Key metrics |
|-----------|------------------|-------------|
| Correctness | Does the code do what it claims? | TypeScript strict, tests pass |
| Determinism | Same input, same file-backed runtime proof | Fake adapter E2E |
| Observability | Can we inspect mailbox/task/evidence state? | `mailbox.jsonl`, `tasks.json`, evidence packet |
| Repeatability | Can we rerun the same stack? | `pnpm verify` gates |
| Guardrails | Do missing prerequisites or missing evidence fail correctly? | blocker exit 2, failed_audit |
| Evidence quality | Is the canonical evidence complete and safe? | `EvidencePacket` validation, redaction checks |

## Fast Gates

```bash
pnpm verify
```

## Live Smoke Gates

```bash
pnpm smoke:local
PASEO_HOST=localhost:6767 pnpm smoke:live
```

Assertions:

- mailbox and task-list artifacts exist
- required tasks complete in dependency order
- FINAL summary and teammate completion messages are present
- evidence validates and contains no secret-shaped substrings

See `docs/harness.md` for the canonical live-smoke knob table.

## PR Acceptance Gates

- [ ] `pnpm verify` passes
- [ ] Relevant docs are synchronized with behavior/contracts/product shape
- [ ] Repository-documentation consistency check passes
