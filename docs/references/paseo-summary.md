# Paseo Summary

## Purpose

Summarize what Paseo contributes as the kernel substrate for this repository.

## What Paseo contributes

Paseo already provides strong kernel capabilities such as:

- daemon and agent lifecycle management
- provider integrations
- timeline and terminal interaction surfaces
- worktree and execution isolation primitives
- client shell patterns and operator interaction substrate

## Why it matters here

This repository benefits by reusing those difficult runtime and shell foundations while focusing its own effort on product semantics and governed execution.

## What this repository adds on top

- playbook / harness / run semantics
- durable run state in Postgres
- approvals and artifacts as governed product objects
- operator-facing run-first views

## Important boundary

Paseo is the runtime and UI kernel reference, not the full product definition for this repository. The authoritative product semantics live in this repository's own docs.
