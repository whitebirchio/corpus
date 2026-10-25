# ADR-011: Medications and supplements as a regimen plus logged exceptions

## Status
Accepted

## Date
2026-07-01

## Context
Daily meds and supplements are taken on a steady schedule. Logging every dose is friction that kills tracking habits. The analytic value is in correlating regimen changes with labs and biometrics ("HRV since starting X").

## Decision
Model a **regimen** (`regimen_items`: dose, schedule, purpose, `started_on`/`ended_on`) and assume adherence. **Log only exceptions** (`regimen_events`: skipped, extra_dose, dose_changed, paused, resumed). A dose change ends the current row and opens a new one, preserving history.

## Alternatives Considered

### Per-dose logging
- Rejected: daily friction for data that's almost always "taken as scheduled".

### A static list
- Rejected: loses history, so there's no correlation against labs or biometrics.

## Consequences
- The natural key `(user_id, name, started_on)` plus date ranges prevents duplicates (ADR-008).
- "What was I taking on date D?" is a date-range query, accurate to the degree that exceptions get logged.

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §2 #7, §5.5 @ specs-archive.
