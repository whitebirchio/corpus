# ADR-015: Drop the MacroFactor import; conversational meal logging is the entry path

## Status
Accepted

## Date
2026-07-02

## Context
Phase 3 originally planned a MacroFactor CSV export parser. By 2026-07-02, the conversational `log_meal` flow covered nutrition entry, and Scott might stop using MacroFactor at all.

## Decision
Drop the MacroFactor import from scope. Conversational `log_meal` is the nutrition entry path.

## Alternatives Considered

### MacroFactor CSV export parser
- Rejected: building a parser for an app that might be abandoned isn't worth it.

## Consequences
- The `macrofactor_export` source value remains in the schema but has no importer.
- Nutrition accuracy now rests on agent estimation. That became the motivation for the food catalog and the FDC/OFF lookups once Corpus fully replaced MacroFactor (ADR-025).

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §2 #8b, §8.4 #5 @ specs-archive.
