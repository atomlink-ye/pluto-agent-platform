# Pluto MVP-alpha — Task Tree (terminal, iteration 2)

Concurrency cap: **<= 2 active tasks at any time** (Link hard limit; covers child agents, OpenCode sessions, heavy CLI jobs).

```
Root Manager (done)
├── P0  Foundation skeleton                    [done]
│       package.json, tsconfig*.json, vitest, src/, tests/, .gitignore, .env.example
├── P1  Adapter contract + Fake adapter        [done]
│       src/contracts/{types,adapter,index}.ts
│       src/adapters/fake/{fake-adapter,index}.ts
│       tests/fake-adapter.test.ts (5 tests)
├── P2  TeamRunService orchestrator            [done]
│       src/orchestrator/{team-config,run-store,team-run-service,index}.ts
│       .pluto/runs/<id>/{events.jsonl, artifact.md}
├── P2  E2E fake adapter test                  [done — 3 tests]
├── P3  OpenCode runtime container             [done]
│       docker/compose.yml (only pluto-runtime), docker/compose.auth.local.yml
│       docker/pluto-runtime/{Dockerfile,opencode.config.json,entrypoint.sh}
│       docker/pluto-mvp/                       [removed — paseo is macOS-only]
├── P4  Live PaseoOpenCodeAdapter              [done — green end-to-end]
│       src/adapters/paseo-opencode/{process-runner,paseo-opencode-adapter,index}.ts
│       tests/paseo-opencode-adapter.test.ts (7 tests)
│       .paseo-pluto-mvp/root/integration-plan.md
├── P5  Live smoke script                      [done]
│       docker/live-smoke.ts (PLUTO_FAKE_LIVE alias, host workspace default)
│       package.json scripts: smoke:fake, smoke:live, smoke:docker
├── P5  Docs                                   [done]
│       README.md, docs/mvp-alpha.md, docs/qa-checklist.md
├── G1  Static gates                           [done]
│       pnpm install / typecheck / test (15/15) / build
├── G2  Fake smoke gate                        [done — status: ok]
├── G3  No-endpoint blocker gate               [done — exit 2, deterministic]
├── G4  pnpm smoke:docker                      [done — status: ok, ~43s, 3 real workers]
└── R0  Final report                           [done]
        .paseo-pluto-mvp/root/final-report.md
```

## Concurrency log

- T0: Root Manager only (active = 1).
- All P-items executed serially in the Root Manager itself; no leaf agents spawned.
- Heavy commands serialized: `pnpm install` → `pnpm typecheck` → `pnpm test` → `pnpm build` → `pnpm submit` → fake/blocker smoke → docker build → docker compose up → live smoke. At no point were two heavy commands inflight simultaneously.
- Single Docker compose up of `pluto-runtime` only; the previous `pluto-mvp` Linux service was removed because Paseo CLI cannot be installed inside a Linux container.

## Iteration 2 closure

Iteration 2 closed the Docker live smoke gate. The live PaseoOpenCodeAdapter now runs end-to-end on host with `paseo run --provider opencode/minimax-m2.5-free --mode build`, parses worker output via `paseo logs --filter text`, and produces a clean markdown artifact with 3 real worker contributions in ~43–80s wall time.
