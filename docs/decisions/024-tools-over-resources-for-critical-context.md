# ADR-024: Context the agent must have is a tool, not an MCP resource

## Status
Accepted

## Date
2026-07-05

## Context
MCP resources (`corpus://profile`, `corpus://schema`) depend on client-side support to be surfaced into a conversation, and Scott observed this to be flaky in practice. A planning conversation leans on the athlete model (equipment, capabilities, constraints) much harder than a one-off query leans on `corpus://schema`. A silent miss there means a plan drafted blind.

## Decision
Expose the athlete-model digest as a **tool** (`get_training_profile`), which is guaranteed callable, not as a resource.

## Alternatives Considered

### An MCP resource, like `corpus://profile` / `corpus://schema`
- Rejected: client surfacing is unreliable, and the silent-miss failure is costly here.

## Consequences
- The spec decided this for `get_training_profile` only. It's a precedent for similar cases: when missing context would silently degrade the agent's output, prefer a tool.
- The planning prompts call `get_training_profile` as their first step.

---
Backfilled 2026-10-25 from specs/04-training-plans/SPEC.md §2 #13 @ specs-archive.
