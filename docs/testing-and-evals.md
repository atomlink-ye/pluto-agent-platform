# docs/testing-and-evals.md — Tests vs Evals Split

## Tests vs Evals

| Category | Location | Purpose |
|----------|----------|---------|
| `tests/` | `tests/*.test.ts` | correctness and file-backed runtime behavior |
| `evals/` | `evals/*` | model/workflow quality |

## Main test lanes

- `tests/manager-run-harness.test.ts` — end-to-end fake run through mailbox/task runtime
- `tests/four-layer-audit.test.ts` — mailbox/task/evidence audit behavior
- `tests/paseo-opencode-adapter.test.ts` — live-adapter boundary behavior
- `tests/cli/run.test.ts` / `tests/cli/runs*.test.ts` — CLI behavior

## Canonical commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:fake
pnpm pluto:run --scenario hello-team --run-profile fake-smoke --workspace .tmp/pluto-cli
pnpm verify
pnpm smoke:local
PASEO_HOST=localhost:6767 pnpm smoke:live
```

## Live-smoke knobs

See `docs/harness.md` for the canonical live-smoke knob table.
