# QUALITY_SCORE.md — Pluto MVP-alpha Quality Dimensions

## Quality Dimensions

| Dimension | What it measures | Key metrics |
|-----------|---------------|-----------|
| **Correctness** | Does the code do what it claims? | TypeScript strict, tests pass |
| **Determinism** | Does same input produce same output? | Fake adapter E2E |
| **Observable** | Can we see what happened? | redacted `events.jsonl`, artifact.md, retry provenance |
| **Repeatable** | Can we reproduce the run? | `pnpm verify` gates |
| **Convergent** | Do agents converge on good output? | Live smoke success |
| **Guardrails** | Does bad input get blocked? | No-paseo blocker exit 2, evidence write failure escalation |
| **Clean artifact** | No leaked prompts or protocols | live-smoke.ts assertions |
| **Evidence quality** | Evidence packet present, schema-valid, no secret leaks | `EvidencePacketV0` validation, write-time redaction assertions |

## Fast Gates (Default Verify)

These run without Docker or live runtime:

```bash
pnpm verify  # typecheck → test → build → smoke:fake → no-paseo-blocker
```

1. **typecheck:** TypeScript strict mode
2. **test:** vitest run (unit + fake adapter E2E)
3. **build:** dist/ output
4. **smoke:fake:** Fake adapter E2E with artifact assertions
5. **no-paseo-blocker:** Smoke with PASEO_BIN unavailable must exit 2

## Broader Validation

Requires Docker or live runtime:

```bash
pnpm smoke:docker   # Docker stack + live smoke
```

## Live Smoke Gates

Runs against real Paseo + OpenCode. Local mode uses the default Paseo daemon/socket; Docker/remote mode sets `PASEO_HOST` so the adapter passes `--host`. `OPENCODE_BASE_URL` is optional debug only:

```bash
pnpm smoke:local   # No Docker, uses host paseo + opencode CLI
PASEO_HOST=localhost:6767 pnpm smoke:live  # Explicit daemon host
OPENCODE_BASE_URL=http://localhost:4096 pnpm smoke:live  # Optional OpenCode debug endpoint
```

Assertions:
- Team Lead session created (`lead_started`)
- At least 2 workers requested and completed
- Artifact references lead, planner, generator, evaluator
- No protocol fragments leaked
- Evidence validates and contains no secret-shaped substrings
- `{"status":"partial"}` is acceptable only for `provider_unavailable` or `quota_exceeded`

## Future Eval Gates

Implemented and planned `evals/` gates:

- **Model quality:** Does the model produce useful artifacts?
- **Workflow quality:** Implemented deterministic fake-adapter lane via `pnpm eval:workflow`.
- **Human eval:** Are artifacts actually useful?

## PR Acceptance Gates

Before merging a PR:

- [ ] `pnpm verify` passes (all fast gates)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] No new leaked secrets in git diff
- [ ] Repository-documentation consistency check passes: code, contracts, CLI behavior, docs/plans, design docs, and reference docs do not contradict each other
- [ ] Affected docs are synchronized when behavior, contracts, workflows, or product shape changed

## Quality Checklist (from docs/qa-checklist.md)

Static:
- [ ] pnpm typecheck
- [ ] pnpm test
- [ ] pnpm build

Fake E2E:
- [ ] pnpm submit (fake adapter)
- [ ] events.jsonl has lead_started, >=2 worker_completed
- [ ] artifact.md references all 4 roles

Live (when applicable):
- [ ] pnpm smoke:local returns status: ok
- [ ] No protocol fragment leaks
- [ ] No-paseo blocker exits 2

## Evidence Quality Dimension (MVP-beta)

The `evidence_quality` eval dimension (weight 0.15 in `evals/runner.ts`) checks:

1. `evidence.md` and `evidence.json` exist in `.pluto/runs/<runId>/`
2. `evidence.json` validates against `EvidencePacketV0` schema after redaction
3. Neither file contains secret-shaped content (sk-* keys, JWTs, GitHub tokens)
4. Persisted event/evidence surfaces never expose adapter `transient.rawPayload`

This dimension is enforced by both the workflow eval (`pnpm eval:workflow`) and the fake smoke test (`pnpm smoke:fake`).

## Non-Goals (What We Don't Measure Yet)

- Full benchmark suite
- Model cost/performance
- Latency SLA
- Security pen-test
