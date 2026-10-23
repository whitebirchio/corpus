# Garmin weigh-ins — implementation notes

**Built 2026-10-23** on branch `worktree-garmin-weigh-ins-spec`, one commit per task (see `tasks/todo.md`). Not yet deployed. The remaining manual steps are listed at the end.

## What landed

Sync job (`apps/garmin-sync/sync.py`):

- `fetch_weigh_ins` calls `get_weigh_ins(start, end)` (`/weight/range?includeAll=true`) and flattens each day's `allWeightMetrics` untouched into `weighIns: { start, end, entries }`. An unexpected response shape raises, so a miss is never sent as "no weigh-ins".
- `pull` forwards the trailing-window block. A fetch failure omits the key and logs a warning.
- `pull --weight-since YYYY-MM-DD` runs the one-time history backfill: weigh-in-only payloads in contiguous 90-day chunks. It is fatal on a fetch failure, printing the resume date.
- `pull --dry-run` prints the payload without posting or saving tokens.
- Shared helpers: `login_from_store`, `post_ingest`, `today_local`.
- Workflow: a `weight_since` dispatch input, passed via env. SETUP §7 step 5 documents the backfill.

Core (`packages/core`):

- `import/garmin.ts`:
  - `garminIngestPayload.weighIns` (optional).
  - `garminWeighInToMeasurement`: grams→kg at `timestampGMT`, with a `calendarDate` + 07:00 fallback. Body fat goes in its column; BMI, water, muscle and bone mass go in `extras` with `garminSamplePk` and `garminCalendarDate`.
  - Upsert on `(user_id, measured_at, 'garmin_export')`.
  - `reconcileWeighIns` deletes rows in the fetched window that Garmin no longer returns.
  - `GarminImportSummary.weighIns { upserted, deleted, skipped }`.
- `repos/checkins.ts` exports `WEIGH_IN_TIME`.
- `repos/summary.ts`: `latestWeighIn { weightKg, measuredOn, source }` (`latestWeightKg` kept).
- `schemas/inputs.ts`: the `weight` description marks it as a fallback only.

Worker (`apps/mcp-server`):

- `get_daily_summary.latestWeight` gains `measuredOn` and `source`, and the tool description explains them.
- `morning_checkin` no longer asks for weight. It reports `latestWeight`, noting when today's hasn't synced yet.
- `log_daily_checkin` says not to ask for weight. `weight` remains accepted as the fallback.

Tests: 13 new import cases in `garmin-import.test.ts` (fixtures copy a live entry) and 2 new summary cases. The suite is at 175 core tests. `sync.py` has no test suite. It was checked with a throwaway stub harness (22 scenarios) that is not committed.

## Deviations from SPEC

1. **Endpoint: `get_weigh_ins`, not `get_body_composition`.** Both returned identical entries in the live probe. `includeAll` explicitly lists every reading per day (§3.1 and §10 updated).
2. **The reconciliation window is keyed on Garmin's `calendarDate`, not Corpus's timezone** (decision 4 and §3.2 updated). This came from an adversarial pass before commit, done inline rather than by a separate reviewer. If the Garmin account's timezone and Corpus's differ, a near-midnight reading Garmin filed outside the queried range would have been deleted, and later trailing windows would never re-fetch it. Rows without a recorded `garminCalendarDate` are never deleted.
3. **`--dry-run` added** (Task 1 spike). It's kept as a permanent debugging aid.
4. **The schema description of `log_daily_checkin.weight` was also changed** (not just the tool description), since the agent sees both.

## Live data notes (from the Task 1 probe, 2026-10-23)

- Scott's 7 recent weigh-ins are all `MANUAL`, with every scale field null. Index-scale handling is tested against the documented field names only.
- The Oct 18 entry was created on Oct 20 (`samplePk` is a creation-time id) and has the same weight as Oct 20 (70.08 kg). It might be a duplicate entry in Garmin. It syncs as is.

## Remaining manual steps

1. **Merge to `main`.** CI deploys the worker. Rollout order doesn't matter: the old worker's non-strict payload schema ignores `weighIns`.
2. **Verify the trailing sync** (Checkpoint A): GitHub → Actions → `garmin-sync` → Run workflow (`days` 3). The log should show `weighIns.upserted` with recent readings. A second run should show `deleted: 0`.
3. **Backfill once** (SETUP §7 step 5): run the workflow with `weight_since`, or run it locally. Then check `query_data`: `select count(*) from body_measurements where source = 'garmin_export'`. Re-run the backfill and confirm the count is unchanged.
4. **Morning check-in** (Checkpoint B): run `morning_checkin` in Claude. It should report the synced weight and not ask for one.
