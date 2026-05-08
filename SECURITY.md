# SECURITY.md — Pluto v2 Policy

## Secrets

Never commit secrets, tokens, credentials, or live auth material.

- `.env` files with real values
- API keys and OAuth tokens
- provider auth files
- connection strings
- raw daemon or provider debug dumps that include secrets

## Active v2 Boundary

Security review on `main` should focus on:

- `src/cli/` argument handling and bridge error reporting
- `packages/pluto-v2-runtime/` adapter boundaries and transcript persistence
- `packages/pluto-v2-runtime/` evidence packet assembly
- retained root utility scripts and tests

## Redaction Expectations

- Persist only the evidence packet and intended transcripts.
- Do not copy raw secret-bearing environment values into evidence outputs.
- Provider stderr and token-shaped values must be redacted or summarized before persistence.
- Workspace-specific absolute paths should be treated as sensitive operational data when emitted to user-facing evidence.

## Verification

- `pnpm test` should cover the retained root utility checks plus package-level redaction and boundary tests.
- `pnpm smoke:live` artifacts must not leak token-shaped substrings or raw provider auth material.

## Legacy Archive

The v1.6 harness may contain historical behavior and file layouts, but it is not an active security surface on `main`.
Reference it only through `origin/legacy-v1.6-harness-prototype`. See `docs/design-docs/v1-archive.md`.
