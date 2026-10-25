# ADR-019: Only conversation-sourced records are editable; imported records are immutable

## Status
Accepted

## Date
2026-07-03

## Context
The concrete pain points were a wrong AI macro estimate and a meal logged twice. Editing or deleting *imported* records collides with the idempotent importers (ADR-008): a re-sync resurrects a deleted Garmin activity, and a re-import overwrites an edit. Scott has no use case for editing Garmin biometric or exercise data, and MacroFactor was being retired (ADR-015).

## Decision
Only `source = "conversation"` records can be edited or deleted. Imported records (`garmin_export`, `macrofactor_export`, `document_extraction`, `checkin`) return `not_editable`. This is **enforced in core**, not just in an adapter.

Edit scope (MCP tools, 2026-07-03):
- **Meals:** full edit (scalar fields, date/time, macros) plus delete. `items` replaces the item list and recomputes totals; `totals` sets totals directly and drops the items. Sending both is rejected at the schema layer, so there's never a half-itemized, half-overridden state (ADR-010).
- **Workouts:** delete plus session-level field edit (title, date/time, RPE, duration, HR, calories, notes). Blocks, movements and sets aren't editable in place; to fix reps or weights, delete and re-log.

## Alternatives Considered

### A tombstone/override layer in core for imported records
- Deferred until a real need appears.

### Full nested workout editing via MCP
- Deferred to a future PWA direct-manipulation UI. It's a large, error-prone tool surface for little conversational gain.

## Consequences
- The write-forward shape from the read-only PWA (stable ids and `source` in payloads, derived daily totals, cascade-deleting children; ADR-016) let edits land without a schema change.
- Mutations report structured outcomes (ADR-020).

---
Backfilled 2026-10-25 from specs/02-pwa-client/SPEC.md §2 #11, §5; specs/03-record-edits/SPEC.md §2 #1–3, #5 @ specs-archive.
