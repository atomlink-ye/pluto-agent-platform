# QA Checklist

Run after meaningful v2 changes on `main`.

## 1. Static Gates

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm spec:hygiene`

## 2. CLI Contract

- [ ] `pnpm pluto:run --spec packages/pluto-v2-runtime/test-fixtures/scenarios/hello-team-paseo-mock/scenario.yaml`
- [ ] stdout matches the v2 bridge shape: `status`, `summary`, `evidencePacketPath`, `transcriptPaths`, `exitCode`
- [ ] invalid or archived legacy flags fail cleanly instead of selecting another runtime path
- [ ] `pnpm pluto:runs replay <runId> --run-dir=<path>` and `pnpm pluto:runs explain <runId> --run-dir=<path>` both produce usable output on a finished run

## 3. Package Coverage

- [ ] `packages/pluto-v2-core/__tests__/` remains green
- [ ] `packages/pluto-v2-runtime/__tests__/` remains green
- [ ] retained root utility tests still pass

## 4. Live Smoke

- [ ] `pnpm smoke:live` succeeds or returns the documented capability-unavailable blocker
- [ ] generated evidence packet is present
- [ ] actor transcripts are written when the run reaches execution
- [ ] no token-shaped or raw auth material appears in smoke artifacts

## 5. Documentation

- [ ] README active usage shows `pluto:run --spec <path>` plus the retained `pluto:runs replay|explain` inspection commands
- [ ] `docs/harness.md` knob table matches the retained v2 smoke script
- [ ] `docs/mvp-alpha.md` matches the v2 CLI contract
- [ ] `docs/design-docs/v1-archive.md` still accurately describes legacy branch recovery
- [ ] `docs/plans/active/v2-rewrite.md` remains in place until its separate post-merge move
