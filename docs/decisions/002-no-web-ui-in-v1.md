# ADR-002: No web UI in v1

## Status
Superseded by ADR-016

## Date
2026-07-01

## Context
Under ADR-001, the MCP server is the product, and Claude's clients are the interface. Building a web UI alongside it would split effort before the core daily loop (check-ins, workouts, meals, regimen, labs) existed.

## Decision
Ship v1 with **no web UI**: MCP only. Keep the core hexagonal (ADR-004), so a dashboard can be added later without rework.

## Alternatives Considered

### Read-only dashboard
- Deferred: useful for glanceable trends, but not needed to prove the conversational loop.

### Full web app
- Rejected: duplicates what the agent surface already does, at much higher build cost.

## Consequences
- All v1 effort went into tools, the data model and imports.
- Superseded on 2026-07-02 once v1 was live and a glanceable view proved worthwhile: ADR-016 adds a PWA as a complementary client.

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §2 #2 @ specs-archive.
