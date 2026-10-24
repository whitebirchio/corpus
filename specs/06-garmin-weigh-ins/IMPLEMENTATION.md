# Garmin weigh-ins — implementation notes

**Built 2026-10-23** on branch `worktree-garmin-weigh-ins-spec`, one commit per task (see `tasks/todo.md`). Shipped in PR #2 (merged 2026-10-23), hardened in PR #3 (2026-10-24), and **closed 2026-10-24**. See "Rollout" at the end.

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

## Post-launch hardening (2026-10-24)

First day in production surfaced three problems, none caused by the epic's code:

1. **GitHub stopped scheduling `garmin-sync` on 2026-10-16** (no runs for a week; no email, since a run that never starts can't fail). Two manual dispatches on 10-23 became uncancellable, undeletable ghost runs (queued, zero jobs; GitHub returns "completed" / "not yet queued" / 403). A disable/enable reset revived the schedule, but runs then arrived 37 min–3 h late and some were dropped. **Fix:** crons moved off the top of the hour (`23 */4`, `47 9`), the 4-hourly window widened to 2 days so a dropped run self-heals, a 15 min job timeout, and a `garminSync` staleness signal in `get_daily_summary` (KV `garmin-last-ingest:<email>`, stale after 12 h, pure logic in core `garminSyncStatus`) that `morning_checkin` reports.
2. **A scheduled ingest died with Cloudflare 1101** after a ~50 s stall (the healthy run took 5 s total) — almost certainly the per-request Neon connection hanging. The route had no error handling and the worker had no persisted logs, so the cause couldn't be confirmed. **Fix:** `observability` enabled; ingest wrapped to log stage/stack and return a structured 500; `sync.py` retries 5xx/network errors on every worker call (all idempotent).
3. **`sync.py` was only tested by a throwaway harness.** **Fix:** committed as `apps/garmin-sync/test_sync.py` (stdlib-only, 17 cases incl. retries) and run in CI.

## Rollout (done)

1. **Merged and deployed.** PR #2 on 2026-10-23, and the hardening PR #3 on 2026-10-24 (CI deploys).
2. **Trailing sync verified.** The dispatched workflow runs were stuck on GitHub's side (see "Post-launch hardening"), so the checks ran through the scheduled run at 10-24 03:13Z and through local pulls (`--days 10`, then `--days 2`). All showed `weighIns.upserted` and `deleted: 0`.
3. **Backfill done locally** (`--weight-since 2010-01-01`): 159 readings, Jun 2023 → Oct 23, matching the `query_data` count exactly. The overlapping pulls kept the count exact (160 after one new reading).
4. **End-to-end confirmed.** The 2026-10-24 08:13 ET Garmin weigh-in became `latestWeight` (155.6 lb, `garmin_export`), `garminSync.stale` read false, and Scott confirmed `morning_checkin` no longer asks for weight.

Not yet observed live (unit-tested, so no action needed): a Garmin-side edit or delete coming through a sync summary as an update or `deleted ≥ 1`, and the first scheduled run on PR #3's `:23` crons. If either misbehaves, `garminSync` and the run log will now show it. See docs/SETUP.md §7, "When it breaks".

Follow-ups outside this epic:
- `get_daily_summary` returns about 120K characters (`insights` ≈57K, `goals` ≈37K) into every daily conversation. Slim these to digests, with details fetched on demand.
- The two ghost dispatch runs (`40039706953`, `40038950538`) need GitHub support to remove.
