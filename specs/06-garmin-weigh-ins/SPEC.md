# Garmin weigh-ins — epic spec

**Status:** Spec drafted and built 2026-10-23; shipped, backfilled, and closed 2026-10-24 — see [IMPLEMENTATION.md](IMPLEMENTATION.md).
**Owner:** Scott Schmalz

## 1. Motivating context

Scott weighs in every morning and today enters the number twice: once in Garmin Connect, once in Corpus via the morning check-in. Corpus does **not** pick up weight from Garmin today:

- `apps/garmin-sync/sync.py` pulls `get_stats`, sleep, HRV, training readiness, max metrics and activities, but never calls a weight or body-composition endpoint.
- `packages/core/src/import/garmin.ts` never writes `body_measurements`.
- The `morning_checkin` prompt (`apps/mcp-server/src/prompts.ts`) explicitly asks for "my morning weigh-in", which is where the second entry comes from.

This epic makes **Garmin Connect the single place a weigh-in is entered**. Corpus syncs it on the existing cron, backfills the full Garmin history once, and the check-in stops asking.

## 2. Decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | **Weigh-ins ride the existing Garmin sync**: one more raw fetch in `sync.py`, all mapping in `core/import/garmin.ts`. | Same architecture as every other Garmin metric (SPEC 01 §8.4): the Python job is a dumb forwarder, there is one PGlite-tested write path, and backfill is just a re-run. |
| 2 | **Stored as `body_measurements` rows with `source = 'garmin_export'`**, upserted on the existing unique key `(user_id, measured_at, source)`. | The table already unifies scale readings and DEXA on one timeline (SPEC 01 §5), and trends, the daily summary and the PWA already read it. Tier-2 natural-key dedup with no migration. |
| 3 | **`measured_at` is Garmin's real timestamp** (`timestampGMT`), not the nominal 07:00 that check-in weigh-ins use. | It's a measured fact and gives each reading a stable key. A same-timestamp edit in Garmin updates in place. |
| 4 | **Deletes in Garmin propagate, but only inside a window that was actually fetched.** The payload carries `weighIns: { start, end, entries }`; core deletes `garmin_export` rows filed under a Garmin `calendarDate` in `[start, end]` that are absent from `entries`. If the fetch fails, the key is omitted and nothing is deleted. | A typo deleted and re-entered in Garmin must not leave a phantom row in Corpus forever. Scoping to an explicit, successfully fetched window means a failed or partial fetch can never look like "Garmin has no weigh-ins". The window is judged by Garmin's own `calendarDate` (stored in `extras`), not Corpus's timezone. If the two zones ever differ, a near-midnight reading Garmin filed outside the range would otherwise be deleted and never re-fetched (found in build review, 2026-10-23). |
| 5 | **The morning check-in never asks for weight.** It reports the latest synced weigh-in and its date. If today's hasn't synced yet (the 4h cron can lag a 7am weigh-in), it says it will arrive on the next sync. | This is the whole point: no double entry. An "ask only if not synced" fallback was rejected because it would still cause double entry on most mornings, given cron timing. |
| 6 | **`log_daily_checkin.weight` stays**, de-emphasized in the tool description. | SPEC 01 §8.4.4 invariant: the conversational path is the permanent fallback when Garmin breaks. |
| 7 | **Historical `checkin` weigh-ins are left alone.** There is no read-side source preference. | Non-destructive. Once the prompt stops asking, new same-day duplicates mostly stop. Where both exist, trends average per bucket (harmless when values agree) and `latestWeightKg` picks the newest `measured_at`. |
| 8 | **Full-history backfill** via a one-time `--weight-since YYYY-MM-DD` run, chunked ~90 days per POST. Scheduled runs keep the trailing 1/7-day window. | Gives `body_weight` trends Scott's whole Garmin history. Chunking keeps each ingest well inside Worker CPU and subrequest limits. |
| 9 | **Scale body-comp extras go in `extras` jsonb**, apart from body-fat %, which has a first-class column. Scale "bone mass" is never written to `bone_mineral_content_kg`. | BIA bone-mass estimates and DEXA BMC are different measurements, and mixing them on one column would corrupt the DEXA trend. |

## 3. Design

### 3.1 Sync job (`apps/garmin-sync/sync.py`)

- `pull --days N`: after the per-day loop, call `garmin.get_weigh_ins(start, today)` once for the window (`/weight/range?includeAll=true`). Flatten every day's `allWeightMetrics` into one list (a shape unwrap only, like the existing `hrvSummary` one — no field mapping) and forward it as:
  ```json
  "weighIns": { "start": "2026-10-17", "end": "2026-10-23", "entries": [ ...raw allWeightMetrics entries... ] }
  ```
  `get_weigh_ins` was chosen over `get_body_composition` (`/weight/dateRange`) because `includeAll` explicitly lists every reading per day; both returned identical entries in the live probe (§10).
  If the fetch raises an exception, **omit `weighIns`** and add a warning to `errors` (same try/except-warn pattern as the other fetches).
- `pull --weight-since YYYY-MM-DD` (backfill): loop in ~90-day chunks from that date to today and POST each as `{ userEmail, days: [], activities: [], weighIns: {...} }`. Print each chunk's summary.
- Workflow: add an optional `weight_since` input to `garmin-sync.yml` `workflow_dispatch`, so the backfill can run from GitHub as well as locally.

### 3.2 Core (`packages/core/src/import/garmin.ts`)

- `garminIngestPayload` gains `weighIns: z.object({ start: z.iso.date(), end: z.iso.date(), entries: z.array(rawObject) }).optional()`.
- Pure mapper `garminWeighInToMeasurement(raw, timezone)` → `{ measuredAt, weightKg, bodyFatPct?, extras } | null`:
  - `measuredAt` = `new Date(timestampGMT)` (epoch ms, UTC). The fallback is `zonedToUtc(calendarDate, "07:00", tz)`, the same nominal time as `WEIGH_IN_TIME` in `repos/checkins.ts` (export it rather than duplicate it). If there is neither, return `null`.
  - `weightKg` = `toKg({ value: weight, unit: "g" })`. Garmin reports grams. If it is missing or ≤0, return `null`.
  - `bodyFatPct` only when >0 (Index scale).
  - `extras`: `garminSamplePk`, `garminCalendarDate` (the reconciliation key), `sourceType` (e.g. `MANUAL`, `INDEX_SCALE`), and when present `bmi`, `bodyWaterPct`, `muscleMassKg`, `boneMassKg` (grams → kg via `toKg`). Undefined fields are dropped, as in `activityExtras`.
- Writer: upsert each mapped row with `onConflictDoUpdate` on `(userId, measuredAt, source)`. Garmin values overwrite.
- Reconciliation: when `weighIns` is present, delete rows where `user_id = ctx.userId AND source = 'garmin_export' AND extras->>'garminCalendarDate' BETWEEN start AND end AND measured_at NOT IN (payload timestamps)`. Rows with no recorded `garminCalendarDate` are never deleted.
- `GarminImportSummary` gains `weighIns: { upserted: string[]; deleted: number; skipped: number }`. Upserted items are ISO timestamps, which keeps the summary readable in the Actions log.

### 3.3 MCP adapter (`apps/mcp-server`)

- `prompts.ts` `morning_checkin`:
  - Step 1: also note the latest weight from `get_daily_summary` (value and date).
  - Step 2: drop "my morning weigh-in".
  - Step 4 recap: include the weight, or "today's weigh-in will sync from Garmin" if the latest isn't from today.
- `tools.ts` `log_daily_checkin` description: "Weigh-ins sync automatically from Garmin Connect. Pass `weight` only if the user volunteers one or says the Garmin sync is down."
- `garmin.ts` ingest route: no logic change, since the payload is already parsed by `garminIngestPayload`. Update the header comment to mention `weighIns`.
- Check that `get_daily_summary` exposes the latest weigh-in's date. If it only returns the value, add `measuredOn` so the prompt can tell "today" from "stale".

### 3.4 Spec history

Append a one-line note to SPEC 01 §8.4.2 ("weigh-ins added in epic 6"), and add the epic-6 line to `specs/README.md`.

## 4. Commands

```sh
npm run typecheck && npm test                     # CI parity
npx vitest run garmin                              # (packages/core) inner loop
python apps/garmin-sync/sync.py pull --days 3      # local smoke run (needs CORPUS_* env)
python apps/garmin-sync/sync.py pull --weight-since 2015-01-01   # one-time backfill
```

## 5. Project structure (files touched)

- `apps/garmin-sync/sync.py`, `.github/workflows/garmin-sync.yml`
- `packages/core/src/import/garmin.ts`, `packages/core/src/repos/checkins.ts` (export `WEIGH_IN_TIME`)
- `packages/core/test/garmin-import.test.ts`
- `apps/mcp-server/src/prompts.ts`, `apps/mcp-server/src/tools.ts`, `apps/mcp-server/src/garmin.ts` (comment), possibly `packages/core/src/repos/summary.ts` (`measuredOn`)
- `docs/SETUP.md` §7 (backfill command), `specs/01-initial-platform/SPEC.md` §8.4 (addendum)

## 6. Code style

Match `import/garmin.ts`: the `num`/`str` helpers, screening of Garmin sentinels before any transform, a pure mapper plus an async writer, and comments citing SPEC 01 §5.9. Python: same per-fetch try/except-warn, no mapping or unit math.

## 7. Testing strategy (PGlite, `garmin-import.test.ts`)

Fixtures copy the live entry shape recorded in §10. Cases:

1. Grams→kg mapping. `timestampGMT` becomes `measured_at`.
2. Fallback to `calendarDate` + 07:00 local when `timestampGMT` is absent.
3. An Index-scale entry fills `body_fat_pct` and the extras. A manual entry fills weight only.
4. Zero, negative or missing weight → skipped and counted.
5. Re-importing the same window is idempotent: the row count is stable, and an edited value updates in place.
6. Reconciliation deletes a `garmin_export` row inside `[start, end]` that is missing from the payload. It keeps `garmin_export` rows outside the window, and keeps `checkin` and DEXA rows inside it.
7. A payload without `weighIns` deletes nothing.
8. The existing days/activities behaviour is unchanged (the current tests stay green).

## 8. Boundaries

- **Always**: canonical kg storage; all mapping in core; idempotent, re-runnable imports; treat a failed fetch as "unknown", never as "empty".
- **Ask first**: deleting or merging historical `checkin` weigh-ins; adding a read-side source-preference rule; adding new first-class body-comp columns.
- **Never**: write anything back to Garmin; touch non-`garmin_export` rows during reconciliation; do unit math in the Python job or a tool handler.

## 9. Non-goals / deferred

- An on-demand "sync now" trigger (worker → GitHub `workflow_dispatch`). Revisit if the 4h lag proves annoying.
- Corpus → Garmin weight sync.
- First-class columns for scale muscle/water/bone mass.

## 10. Open questions / risks

- ~~Field names and units unverified~~ **Resolved 2026-10-23** by a live `pull --days 7 --dry-run` (Task 1). Each weigh-in entry from both endpoints has this shape (values from a manual entry):
  ```json
  { "samplePk": 1792754614878, "date": 1792740209005, "calendarDate": "2026-10-23",
    "weight": 70397.0, "bmi": null, "bodyFat": null, "bodyWater": null, "boneMass": null,
    "muscleMass": null, "physiqueRating": null, "visceralFat": null, "metabolicAge": null,
    "sourceType": "MANUAL", "timestampGMT": 1792754609005, "weightDelta": null }
  ```
  - `weight` is **grams**. `timestampGMT` is the true UTC instant in epoch ms (converts to 07:23 America/New_York here).
  - `date` is **local wall-clock time encoded as if it were UTC** (off by the UTC offset), so it must never be used as `measured_at`.
  - `samplePk` is the entry's creation time and id: a backdated entry (Oct 18 entered on Oct 20) keeps its creation-time `samplePk` but carries the measurement's `timestampGMT`. Store it in `extras` only.
  - Scale fields are all null for `MANUAL` entries. No Index-scale sample exists yet, so scale-field handling is unit-tested against the documented names only.
  - `get_weigh_ins` returns `{ dailyWeightSummaries: [{ summaryDate, numOfWeightEntries, latestWeight, allWeightMetrics: [...] }], totalAverage, previousDateWeight, nextDateWeight }`.
- Garmin may cap the range of a single `get_weigh_ins` call. The 90-day chunking should cover that; confirm on the first backfill.
