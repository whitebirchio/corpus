# ADR-020: Mutations return structured status unions, not thrown errors

## Status
Accepted

## Date
2026-07-03

## Context
The agent needs to tell the user what happened after an edit or delete: done, nothing matched, or not allowed. Exceptions surface to the agent as opaque error strings. The existing write paths (`LogMealResult`, `LogWorkoutResult`) already returned typed outcomes for dedup.

## Decision
Edit and delete operations return a discriminated union: `updated` / `deleted` / `not_found` / `not_editable`.

## Alternatives Considered

### Thrown errors
- Rejected: the agent gets an exception string instead of an actionable result to surface.

## Consequences
- Consistent with the dedup results that return candidates (ADR-008); every mutation outcome is something the agent can relay or act on.
- The policy behind `not_editable` comes from core (ADR-019).

---
Backfilled 2026-10-25 from specs/03-record-edits/SPEC.md §2 #4 @ specs-archive.
