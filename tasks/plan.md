# Implementation Plan: Garmin weigh-ins (epic 6)

Spec: [`specs/06-garmin-weigh-ins/SPEC.md`](../specs/06-garmin-weigh-ins/SPEC.md). Task checklist: [`tasks/todo.md`](todo.md).

## Overview

Weigh-ins entered in Garmin Connect sync into `body_measurements` (`source = 'garmin_export'`). The sync uses Garmin's real timestamps and reconciles deletes, but only within the window it fetched. A one-time `--weight-since` run backfills the full history. Then the `morning_checkin` prompt stops asking for weight. No schema migration is needed, because the existing `(user_id, measured_at, source)` unique key already serves as the natural key.

## Dependency graph

```
garminIngestPayload.weighIns  (core contract — Task 2)
    ├── mapper + upsert          (core — Task 2)
    │     └── delete reconciliation (core — Task 3)
    ├── sync.py trailing-window fetch (Python — Task 4)  ← needs field names confirmed (Task 1)
    │     └── --weight-since backfill + workflow input + SETUP docs (Task 7)
    └── (deploy, then live backfill run — Task 8)

getDailySummary.latestWeight date  (core + tool — Task 5)
    └── morning_checkin prompt + log_daily_checkin description (Task 6)
```

Tasks 2–4 and 5–6 are independent chains. Task 6 should still not ship before Task 4 is deployed: otherwise the check-in stops asking for weight before the sync starts providing it.

## Architecture decisions (from the spec, restated as build constraints)

- **One write path.** All mapping, unit conversion (g → kg via `toKg`) and reconciliation live in `packages/core/src/import/garmin.ts`. `sync.py` only forwards raw `get_weigh_ins` entries (flattened `allWeightMetrics`).
- **The `weighIns` key is optional and carries its window** (`start`, `end`, `entries`). If it is absent, core does nothing, which keeps a failed fetch distinct from an empty one.
- **Reconciliation deletes only `garmin_export` rows inside `[start, end]`**, using local dates in the user's timezone.
- **Reuse, don't duplicate**: export `WEIGH_IN_TIME` from `repos/checkins.ts`. Use `zonedToUtc` from `time.ts`, and `num`/`str` from the importer.
- **Ingest route unchanged**: `apps/mcp-server/src/garmin.ts` already parses via `garminIngestPayload`. Only its header comment changes.

## Task list

### Phase 1: Ingest path (fail fast on the riskiest unknown)
- [x] Task 1: Confirm the live weigh-in payload shape (spike, needs Scott's env) — done 2026-10-23, `get_weigh_ins` chosen
- [x] Task 2: Core: weigh-ins in the ingest payload upsert into `body_measurements` — done 2026-10-23
- [x] Task 3: Core: window-scoped delete reconciliation — done 2026-10-23 (window keyed on Garmin calendarDate)
- [ ] Task 4: Sync job forwards the trailing-window weigh-ins

### Checkpoint A: a weigh-in entered in Garmin reaches Corpus
- [ ] `npm run typecheck && npm test` green
- [ ] Local `sync.py pull --days 3` against `wrangler dev` (or prod after deploy) reports `weighIns.upserted ≥ 1`
- [ ] Human review before touching the conversational surface

### Phase 2: Stop asking
- [ ] Task 5: Daily summary exposes the latest weigh-in's date and source
- [ ] Task 6: `morning_checkin` stops asking for weight; `log_daily_checkin` de-emphasizes it

### Checkpoint B: one-entry morning
- [ ] Tests and typecheck green
- [ ] In Claude, against the local worker or after deploy: `morning_checkin` reports the synced weight and never asks for one

### Phase 3: History and records
- [ ] Task 7: `--weight-since` backfill, `weight_since` workflow input, SETUP docs
- [ ] Task 8: Spec bookkeeping, deploy, and a one-time backfill run (part manual)

### Checkpoint C: complete
- [ ] All spec §1 acceptance criteria met (see todo.md)
- [ ] Backfill re-run leaves the row count unchanged
- [ ] Ready for merge to main (CI deploys)

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `garminconnect` 0.3.6 field names or units differ from what the spec assumes (`timestampGMT`, `weight` in g, `samplePk`, `bodyFat`) | High: wrong values or every entry skipped | Task 1 captures a real payload first, and Task 2's fixtures copy it verbatim |
| Reconciliation deletes the wrong rows (timezone edge at window bounds, or another source) | High: data loss | Filter on `source = 'garmin_export'` in SQL. Tests cover rows just outside the window, rows in other sources, and an absent key |
| Garmin caps or slows wide date ranges | Medium: backfill fails | 90-day chunks, each POST independent and idempotent, so a re-run resumes cleanly |
| Prompt change ships before sync is live | Medium: weight silently not captured for a few days | Merge Phase 2 only alongside or after Phase 1 is deployed. One PR for the epic does that naturally |
| Same-day `checkin` and `garmin_export` rows during transition | Low: trend averages two nearly equal values | Accepted per spec decision 7. Revisit only if values diverge |

## Open questions

- Task 1 needs Scott's local `CORPUS_INGEST_SECRET` and a working Garmin token. If that isn't available, Task 2 proceeds on the library's documented shape, and Task 1 is re-checked at Checkpoint A.
- The earliest date for the backfill (`--weight-since`). Scott picks it at run time. Garmin returns nothing before the account's first weigh-in, so an early date such as `2010-01-01` is safe.

## Verification commands

```sh
npm run typecheck && npm test                     # repo root, CI parity
npx vitest run garmin                              # packages/core, inner loop
python -m py_compile apps/garmin-sync/sync.py      # Python syntax check (no Python test suite in repo)
python apps/garmin-sync/sync.py pull --days 3 --dry-run   # Task 1/4: print payload, no POST
```
