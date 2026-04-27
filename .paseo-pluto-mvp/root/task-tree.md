# Pluto MVP-alpha — Task Tree (terminal)

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
├── P3  Docker + OpenCode runtime              [done]
│       docker/compose.yml, docker/compose.auth.local.yml
│       docker/pluto-runtime/{Dockerfile,opencode.config.json,entrypoint.sh}
│       docker/pluto-mvp/{Dockerfile,entrypoint.cjs}
├── P4  Live PaseoOpenCodeAdapter              [done — live exec blocked]
│       src/adapters/paseo-opencode/{process-runner,paseo-opencode-adapter,index}.ts
│       .paseo-pluto-mvp/root/integration-plan.md
├── P5  Live smoke script                      [done — preflight blocker tested]
│       docker/live-smoke.ts
├── P5  Docs                                   [done]
│       README.md, docs/mvp-alpha.md, docs/qa-checklist.md
├── G1  Static gates                           [done]
│       pnpm install / typecheck / test (8/8) / build
├── G2  Docker live smoke                      [BLOCKED]
│       Cause: no paseo provider alias for OpenCode on this host
│       Fix:   integration-plan.md §2.1
└── R0  Final report                           [done]
        .paseo-pluto-mvp/root/final-report.md
```

## Concurrency log

- T0: Root Manager only (active = 1).
- All P-items executed serially in the Root Manager itself; no leaf agents spawned because each unit was small enough that delegation overhead would have exceeded savings (and would have eaten part of the 2-task cap with no real parallel speedup, since heavy commands needed serialization anyway).
- Heavy commands serialized: `pnpm install` → `pnpm typecheck` → `pnpm test` → `pnpm build` → `pnpm submit` → live-smoke fake → live-smoke blocker. At no point were two heavy commands inflight simultaneously.
- No Docker `build` / `up` invocations were performed (they would have been serialized too — see final-report §6 for why they were intentionally deferred).
