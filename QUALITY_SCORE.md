# QUALITY_SCORE.md — Pluto MVP-alpha Quality Dimensions

## Quality Dimensions

| Dimension | What it measures | Key metrics |
|-----------|---------------|-----------|
| **Correctness** | Does the code do what it claims? | TypeScript strict, tests pass |
| **Determinism** | Does same input produce same output? | Fake adapter E2E |
| **Observable** | Can we see what happened? | events.jsonl, artifact.md |
| **Repeatable** | Can we reproduce the run? | `pnpm verify` gates |
| **Convergent** | Do agents converge on good output? | Live smoke success |
| **Guardrails** | Does bad input get blocked? | No-endpoint blocker exit 2 |
| **Clean artifact** | No leaked prompts or protocols | live-smoke.ts assertions |

## Fast Gates (Default Verify)

These run without Docker or live runtime:

```bash
pnpm verify  # typecheck → test → build → smoke:fake → no-endpoint-blocker
```

1. **typecheck:** TypeScript strict mode
2. **test:** vitest run (unit + fake adapter E2E)
3. **build:** dist/ output
4. **smoke:fake:** Fake adapter E2E with artifact assertions
5. **no-endpoint-blocker:** Smoke with OPENCODE_BASE_URL unset must exit 2

## Broader Validation

Requires Docker or live runtime:

```bash
pnpm smoke:docker   # Docker stack + live smoke
```

## Live Smoke Gates

Runs against real Paseo + OpenCode:

```bash
OPENCODE_BASE_URL=http://localhost:4096 pnpm smoke:live
```

Assertions:
- Team Lead session created (`lead_started`)
- At least 2 workers requested and completed
- Artifact references lead, planner, generator, evaluator
- No protocol fragments leaked

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
- [ ] docs/ synchronized if behavior changed

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
- [ ] pnpm smoke:live returns status: ok
- [ ] No protocol fragment leaks
- [ ] No-endpoint blocker exits 2

## Non-Goals (What We Don't Measure Yet)

- Full benchmark suite
- Model cost/performance
- Latency SLA
- Security pen-test
