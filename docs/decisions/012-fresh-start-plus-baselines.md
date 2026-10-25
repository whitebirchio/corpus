# ADR-012: Fresh start plus baseline imports, no full historical backfill

## Status
Accepted

## Date
2026-07-01

## Context
Years of history exist across Garmin, MacroFactor, lab portals and PDFs. Importing all of it up front would delay a working daily loop, and much of it lacks the structure the new model wants.

## Decision
Start fresh. Import only **current baselines**: recent labs (Function Health, PCP), DexaFit/RMR/VO2 Max results, the current med/supplement regimen, and current goals. The schema accepts arbitrary historical dates in case that changes.

## Alternatives Considered

### Full backfill
- Rejected: large up-front effort before the core loop is proven.

### Fresh only (no baselines)
- Rejected: lab and body-comp questions need baselines from day one.

## Consequences
- Phase 2's exit criterion was importing the real baselines: the Function Health panel, DexaFit/RMR/VO2 Max, current regimen and goals.
- Targeted backfills remain possible when cheap. The Garmin weigh-in history was later backfilled by re-running the idempotent sync with a wider window (ADR-026), without changing this decision for other domains.

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §1 #8, §2 #3, §10; specs/06-garmin-weigh-ins/SPEC.md §2 #8 @ specs-archive.
