# ADR-026: Garmin Connect is the weigh-in source of truth

## Status
Accepted

## Date
2026-10-23

## Context
Scott was entering morning weight twice: in Garmin Connect and in the Corpus check-in. Garmin weigh-ins were not part of the nightly sync (ADR-014). Deleting and re-entering a typo in Garmin must not leave a phantom row in Corpus forever, and a failed or partial fetch must never look like "Garmin has no weigh-ins".

## Decision
- **Weigh-ins ride the existing sync.** There is one more raw fetch in `sync.py` (`get_weigh_ins`), and all mapping lives in `core/import/garmin.ts` (ADR-014).
- **They are stored as `body_measurements` rows with `source = 'garmin_export'`**, upserted on the existing `(user_id, measured_at, source)` key (ADR-008, tier 2). No migration was needed.
- **`measured_at` is Garmin's real `timestampGMT`**, not the nominal 07:00 that check-in weigh-ins use.
- **Deletes propagate only inside the window actually fetched.**
  - The payload carries `weighIns: { start, end, entries }`.
  - Core deletes `garmin_export` rows filed under a Garmin `calendarDate` in `[start, end]` that are absent from `entries`.
  - If the fetch fails, the key is omitted and nothing is deleted.
  - The window is judged by Garmin's own `calendarDate` (stored in `extras`), not by Corpus's timezone.
  - Rows without a recorded `calendarDate` are never deleted.
- **The morning check-in never asks for weight.** It reports the latest synced weigh-in and its date, and says it will arrive on the next sync if today's hasn't synced yet. `log_daily_checkin.weight` stays as the permanent fallback, de-emphasized in its description.
- **History is backfilled once** via `--weight-since`, chunked ~90 days per POST.
- **Scale body-composition extras go in `extras` jsonb.** Body-fat % has a column. Scale "bone mass" is never written to `bone_mineral_content_kg`.

## Alternatives Considered

### "Ask for weight only if not yet synced"
- Rejected: given cron timing, it would still cause double entry most mornings.

### Keying the delete window on Corpus's timezone
- Rejected in build review. A near-midnight reading that Garmin filed outside the range would be deleted and never re-fetched.

### `get_body_composition`
- Not chosen. It was identical in the live probe, but `get_weigh_ins` (`includeAll`) explicitly lists every reading.

### A read-side source preference over historical check-in weigh-ins
- Rejected: non-destructive coexistence instead. Trends average per bucket, and `latestWeightKg` picks the newest `measured_at`.

## Consequences
- **Garmin payload traps** (from the live probe):
  - `weight` is in **grams**
  - `timestampGMT` is the true UTC instant
  - `date` is local wall-clock time encoded as UTC, so it must **never** be used
  - `samplePk` is a creation-time id, so it's kept in `extras` only
- 159 historical weigh-ins (June 2023 onward) were backfilled at launch.
- BIA bone-mass estimates and DEXA BMC stay separate measurements, so the DEXA trend isn't corrupted.
- Not yet observed live, though unit-tested: a Garmin-side edit or delete arriving through a sync summary.

---
Backfilled 2026-10-25 from specs/06-garmin-weigh-ins/SPEC.md §1, §2 #1–9, §10 and IMPLEMENTATION.md "Deviations", "Live data notes" and "Rollout", and specs/README.md epic 6 @ specs-archive.
