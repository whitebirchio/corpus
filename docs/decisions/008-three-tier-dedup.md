# ADR-008: Every write is dedup-aware — three tiers

## Status
Accepted

## Date
2026-07-01

## Context
The same lab panel, day, workout or export imported twice must not create duplicate records. The sample data already had two byte-identical DexaFit exports. But some records have no stable identity: you can legitimately eat two identical snacks or do the same session twice.

## Decision
Corpus never blindly inserts. There are three tiers, applied by record type:

1. **Content hash (opaque files).** `documents.sha256`, unique on `(user_id, sha256)`. Re-uploading the same PDF reuses the existing document.
2. **Natural-key upsert (records with a stable identity).** A unique constraint on the business key, with `INSERT … ON CONFLICT DO UPDATE`. Where the origin system supplies an id, `source_ref` is the key, unique on `(user_id, source, source_ref)`. Examples: `daily_metrics (user_id, local_date)` merges, with measured fields winning and subjective fields preserved; `lab_panels` keys on accession number; `body_measurements` on `(user_id, measured_at, source)`.
3. **Agent-mediated soft match (no reliable key).** For conversational meals and workouts, the write tool checks for near-matches and **returns candidates for the agent to confirm** instead of guessing. The database stops silent duplication; the agent resolves real ambiguity out loud.

**Import contract:** every importer is safely re-runnable. Overlapping windows update existing rows, insert only what's new, and report `{created, updated, skipped}`.

## Alternatives Considered

### Plain inserts, with dedup cleaned up later
- Not recorded as a considered option in the specs. It was ruled out up front by making dedup "a first-class requirement".

## Consequences
- Backfill is just a re-run (ADR-014). The Garmin sync re-pulls a trailing window every time.
- A changed value on an existing lab analyte is surfaced as a conflict, not silently overwritten.
- Tier 3's "candidates, not guesses" pattern recurs in later designs:
  - planned↔actual workout linking (ADR-023)
  - food resolution (ADR-025)
  - why imported records stay uneditable (ADR-019)

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §5, §5.9 @ specs-archive.
