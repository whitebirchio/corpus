# Todo: Garmin weigh-ins (epic 6)

Plan: [tasks/plan.md](plan.md) · Spec: [specs/06-garmin-weigh-ins/SPEC.md](../specs/06-garmin-weigh-ins/SPEC.md)

---

## Task 1: Confirm the live weigh-in payload shape ✅

**Description:** Add a `--dry-run` flag to `sync.py pull` that fetches everything as usual, including a new `get_body_composition(start, today)` call, and prints the JSON payload instead of POSTing it or saving tokens. Run it once against Scott's account and save a scrubbed sample of `dateWeightList` (one manual entry, and one scale entry if any exist) as the canonical fixture shape for Task 2.

**Acceptance criteria:**
- [x] `pull --dry-run` prints the payload and makes no `POST /garmin/ingest` or `PUT /garmin/tokens` calls (verified with a stubbed Garmin/requests harness: only `GET /garmin/tokens` issued)
- [x] The actual field names and units for timestamp, weight, sample id, body fat and source type are recorded in the spec §10 (resolved 2026-10-23: grams, `timestampGMT` = UTC ms, `date` is a local-as-UTC trap; `get_weigh_ins` chosen)

> Build note: the library has two candidate endpoints, `get_body_composition` (`/weight/dateRange`) and `get_weigh_ins` (`/weight/range?includeAll=true`). The dry run dumps both under `weighInProbe`, and the live output decides which one Task 4 forwards (it must list every individual reading with a stable timestamp/id).

**Verification:**
- [x] `python -m py_compile apps/garmin-sync/sync.py`
- [x] Manual: Scott ran `pull --days 7 --dry-run` against prod (7 manual entries, 2026-10-17..23, both endpoints identical)

**Dependencies:** None
**Files likely touched:** `apps/garmin-sync/sync.py`, `specs/06-garmin-weigh-ins/SPEC.md`
**Estimated scope:** XS

---

## Task 2: Core: weigh-ins in the ingest payload upsert into `body_measurements`

**Description:** Extend `garminIngestPayload` with an optional `weighIns: { start, end, entries }`. Add a pure `garminWeighInToMeasurement(raw, timezone)` mapper and upsert the mapped rows on `(user_id, measured_at, source = 'garmin_export')`. Export `WEIGH_IN_TIME` from `repos/checkins.ts` for the `calendarDate` fallback. Add `weighIns: { upserted, deleted: 0, skipped }` to `GarminImportSummary`.

**Acceptance criteria:**
- [ ] A Garmin entry with weight in grams is stored as canonical kg at its real `timestampGMT`. Body fat and the scale extras land per spec §3.2, and scale bone mass never goes in `bone_mineral_content_kg`
- [ ] Entries with missing, zero or negative weight, or with no usable time, are skipped and counted
- [ ] Re-importing the same payload leaves the row count unchanged, and an edited weight updates in place

**Verification:**
- [ ] Tests pass: `npx vitest run garmin` (in `packages/core`), with new cases using Task 1's fixture shape
- [ ] Build: `npm run typecheck`

**Dependencies:** Task 1 (fixture shape; can start on the library's documented shape if Task 1 is blocked)
**Files likely touched:** `packages/core/src/import/garmin.ts`, `packages/core/src/repos/checkins.ts`, `packages/core/test/garmin-import.test.ts`
**Estimated scope:** M

---

## Task 3: Core: window-scoped delete reconciliation

**Description:** When `weighIns` is present, delete `garmin_export` rows whose local date (user timezone) falls in `[start, end]` and whose `measured_at` isn't among the payload's mapped timestamps. Report `deleted` in the summary.

**Acceptance criteria:**
- [ ] A `garmin_export` row inside the window that is missing from the payload is deleted. Rows outside the window, and `checkin` and DEXA rows inside it, survive
- [ ] A payload with no `weighIns` key deletes nothing. An empty `entries` with a window deletes that window's `garmin_export` rows (Garmin really has none)
- [ ] Window bounds use local dates (a reading late on `end` in the user's timezone counts as in the window)

**Verification:**
- [ ] Tests pass: `npx vitest run garmin`
- [ ] Build: `npm run typecheck`

**Dependencies:** Task 2
**Files likely touched:** `packages/core/src/import/garmin.ts`, `packages/core/test/garmin-import.test.ts`
**Estimated scope:** S

---

## Task 4: Sync job forwards the trailing-window weigh-ins

**Description:** In `pull`, call `get_weigh_ins(start, today)`, flatten each day's `allWeightMetrics`, and forward `weighIns: { start, end: today, entries }`. Remove the dry-run `weighInProbe` (it's no longer needed once the real key is sent; `--dry-run` keeps printing the payload). On a fetch exception, omit the key and add a warning to `errors`. Update the ingest route header comment and the `sync.py` docstring to mention weigh-ins.

**Acceptance criteria:**
- [ ] Scheduled runs (`--days 1` / `--days 7`) include `weighIns` covering exactly the window they fetched
- [ ] A failed body-comp fetch doesn't fail the run and doesn't send `weighIns`

**Verification:**
- [ ] `python -m py_compile apps/garmin-sync/sync.py`
- [ ] Manual: `pull --days 3 --dry-run` shows `weighIns`. A real `pull --days 3` against `npm run dev` (or prod after deploy) prints `weighIns.upserted` ≥ 1, and a second run shows the same rows with no new inserts

**Dependencies:** Tasks 1, 2, 3 (the server must accept and reconcile the key before the job sends it)
**Files likely touched:** `apps/garmin-sync/sync.py`, `apps/mcp-server/src/garmin.ts`
**Estimated scope:** S

---

## Checkpoint A: a weigh-in entered in Garmin reaches Corpus
- [ ] `npm run typecheck && npm test` green
- [ ] Task 4's manual run confirmed
- [ ] Human review before Phase 2

---

## Task 5: Daily summary exposes the latest weigh-in's date and source

**Description:** `getDailySummary` already selects `measuredAt` for the latest weight but drops it. Return `latestWeighIn: { weightKg, measuredOn (local date), source }` (keeping `latestWeightKg` for back-compat). Pass `measuredOn` and `source` through the `get_daily_summary` tool's `latestWeight` object so the prompt can tell whether a reading is from today.

**Acceptance criteria:**
- [ ] `get_daily_summary` shows the latest weight with its local date and source
- [ ] Existing summary consumers (PWA, tools) keep working unchanged

**Verification:**
- [ ] Tests pass: `npx vitest run summary` (add or extend a case asserting `measuredOn`/`source`)
- [ ] Build: `npm run typecheck` (whole workspace, which catches `apps/web` consumers)

**Dependencies:** None (independent of Tasks 1–4)
**Files likely touched:** `packages/core/src/repos/summary.ts`, `packages/core/test/summary*.test.ts`, `apps/mcp-server/src/tools.ts`
**Estimated scope:** S

---

## Task 6: `morning_checkin` stops asking for weight; `log_daily_checkin` de-emphasizes it

**Description:** Edit the `morning_checkin` prompt per spec §3.3:
- Step 1 notes the latest weight from `get_daily_summary`.
- Step 2 no longer asks for a weigh-in.
- The recap includes the weight, or "today's weigh-in will sync from Garmin" when `measuredOn` isn't today.

Also update the `log_daily_checkin` description: weight comes from Garmin, so pass it only if the user volunteers it or says the sync is down.

**Acceptance criteria:**
- [ ] The prompt text contains no request for a weigh-in
- [ ] The tool description steers away from asking, and `weight` stays accepted (fallback invariant)

**Verification:**
- [ ] Build: `npm run typecheck`
- [ ] Manual: in Claude (or the MCP inspector against `npm run dev`), run `morning_checkin`. It reports the synced weight with its date and does not ask for weight

**Dependencies:** Task 5. Ship together with or after Phase 1 is deployed (see plan risks)
**Files likely touched:** `apps/mcp-server/src/prompts.ts`, `apps/mcp-server/src/tools.ts`
**Estimated scope:** XS

---

## Checkpoint B: one-entry morning
- [ ] `npm run typecheck && npm test` green
- [ ] Task 6's manual check confirmed

---

## Task 7: `--weight-since` backfill, `weight_since` workflow input, SETUP docs

**Description:** Add `pull --weight-since YYYY-MM-DD`. It loops 90-day chunks up to today and POSTs each as `{ userEmail, days: [], activities: [], weighIns }`, printing a per-chunk summary. It fails loudly (non-zero exit) if a chunk's POST fails, and logs the chunk so a re-run is easy. Add an optional `weight_since` input to `garmin-sync.yml` `workflow_dispatch`. Document the one-time backfill in `docs/SETUP.md` §7.

**Acceptance criteria:**
- [ ] The backfill covers `[weight_since, today]` in contiguous chunks with no gaps or overlaps (each chunk's `end + 1 day` = the next chunk's `start`)
- [ ] Re-running the backfill is a no-op for the row count
- [ ] Scheduled cron behaviour is unchanged when `weight_since` is empty

**Verification:**
- [ ] `python -m py_compile apps/garmin-sync/sync.py`
- [ ] Manual: `pull --weight-since <date ~200 days ago> --dry-run` prints 3 chunks with correct bounds

**Dependencies:** Task 4
**Files likely touched:** `apps/garmin-sync/sync.py`, `.github/workflows/garmin-sync.yml`, `docs/SETUP.md`
**Estimated scope:** S

---

## Task 8: Spec bookkeeping, deploy, and a one-time backfill run

**Description:**
- Append the epic-6 note to SPEC 01 §8.4.2.
- Write `specs/06-garmin-weigh-ins/IMPLEMENTATION.md` (any deviations, remaining manual steps).
- Mark epic 6 as built in `specs/README.md`.
- After merge (CI deploys the worker), Scott runs the backfill once.

**Acceptance criteria:**
- [ ] Spec history updated per the append-only convention
- [ ] Backfill run: the `query_data` count of `body_measurements WHERE source = 'garmin_export'` roughly matches Garmin's history, and an immediate re-run leaves it unchanged

**Verification:**
- [ ] `npm run typecheck && npm test`
- [ ] Manual (Scott): run the `garmin-sync` workflow with `weight_since` set (or run it locally), then query the count twice

**Dependencies:** Tasks 1–7
**Files likely touched:** `specs/01-initial-platform/SPEC.md`, `specs/06-garmin-weigh-ins/IMPLEMENTATION.md`, `specs/README.md`
**Estimated scope:** XS

---

## Checkpoint C: complete
- [ ] Weigh-in entered in Garmin appears in Corpus after the next sync (≤4h), in kg at its real time
- [ ] An edit in Garmin updates the row, and a delete in Garmin removes it on the next covering run
- [ ] Re-runs (scheduled or backfill) create no duplicates
- [ ] `morning_checkin` never asks for weight, and `log_daily_checkin.weight` still works as a fallback
- [ ] Ready for review and merge
