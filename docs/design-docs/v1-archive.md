# v1 Archive

## Decision

S7 removes the v1.6 harness from `main` and keeps it only as a git archive.
The active mainline is v2-only.

## Archive Branch

- branch: `legacy-v1.6-harness-prototype`
- remote: `origin`

## How To Fetch

```bash
git fetch origin legacy-v1.6-harness-prototype
git switch --detach origin/legacy-v1.6-harness-prototype
```

If you need a local branch:

```bash
git switch -c legacy-v1.6-harness-prototype --track origin/legacy-v1.6-harness-prototype
```

## What Is Recoverable

- the v1.6 manager-run harness source tree
- v1.6 CLI command implementations and selectors
- v1.6 tests, smoke harness, eval assets, and authored config directories
- historical documentation describing the pre-S7 runtime surface

## What Is Not On Main Anymore

- `--runtime=v1`
- name-based selectors such as `--scenario`, `--playbook`, and `--run-profile`
- v1.6 auxiliary commands and their active docs
- the v1.6 harness as a supported runtime path

## Recovery Rule

Recover by checking out the archive branch or copying specific files from it.
Do not restore v1.6 surfaces to `main` as compatibility clutter; any needed behavior must be reintroduced as explicit v2-shaped work.
