# ADR-013: Biometrics via check-in plus periodic Garmin export imports

## Status
Superseded by ADR-014

## Date
2026-07-01

## Context
Garmin holds the wearable biometrics (steps, HRV, resting HR, sleep, activities). Direct integrations were judged too flaky because they rely on unofficial, reverse-engineered APIs.

## Decision
Biometrics enter through a **~30-second daily conversational check-in** (read off the watch or app), reconciled periodically by **Garmin Connect exports** (CSV/FIT/ZIP). The export is uploaded via presigned URL and parsed deterministically in the Worker (`import_export_file`), in chunked batches to respect CPU limits. Export values win on measured fields; subjective check-in fields are preserved.

## Alternatives Considered

### Unofficial Garmin API sync
- Rejected at the time: flaky.

## Consequences
- A weekly export-import routine was planned as a Phase 3 exit criterion.
- Superseded 2026-07-02, before the export parser was built. The manual routine was recurring friction, and research showed the unofficial-API route was viable if run outside the Workers sandbox (ADR-014). The daily check-in survived as the permanent fallback.

---
Backfilled 2026-10-25 from the original decision #8 and §8.4 in SPEC.md at commit 13df5d5, and specs/01-initial-platform/SPEC.md §2 #8 @ specs-archive.
