# DESIGN.md — Pluto MVP-alpha Design Principles

## MVP Goal

Prove the smallest closed loop where Pluto runs an authored agent team through the v1.6
mailbox/task-list runtime and emits audit-grade evidence.

## Design Principles

1. **Playbook-first:** authored YAML defines the team and workflow.
2. **Mailbox-first coordination:** teammate coordination is typed mailbox + shared tasks,
   not marker parsing.
3. **File-backed evidence:** mailbox/task mirrors are durable local proof surfaces.
4. **Single adapter seam:** runtime specifics stay behind `PaseoTeamAdapter`.
5. **Fail-closed audit:** missing files, missing mailbox/task evidence, or failed commands
   block success.
6. **No DB:** MVP state stays in files.

## Why host-driven live mode

Paseo CLI is host-native, so live smoke runs on host while Docker remains optional for
debug-oriented helper paths.
