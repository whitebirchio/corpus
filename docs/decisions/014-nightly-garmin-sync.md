# ADR-014: Nightly Garmin sync via the unofficial API in GitHub Actions

## Status
Accepted

## Date
2026-07-02

## Context
ADR-013's manual export routine was recurring friction, and automated biometrics were wanted. Research on 2026-07-02 found:
- **Garmin's official Health API** is closed to individuals (company email/entity required), and the program is suspended.
- **Paid aggregators** (Terra, Spike) are priced for B2B at ≥$300/year, far past the budget (ADR-003).
- **The unofficial `python-garminconnect` library** is actively maintained, but it uses socket-based HTTP that the Workers sandbox can't run, in Python or TypeScript.

## Decision
- Run the unmodified `garminconnect` library as a **GitHub Actions scheduled job** (`apps/garmin-sync/sync.py`, real Python). It authenticates with a cached session-token blob stored in Worker KV (fetched and updated via `/garmin/tokens`). A one-time local, MFA-capable `bootstrap` run seeds the tokens, so Garmin credentials never leave Scott's machine.
- The job pulls a **trailing window** and POSTs the **raw JSON** to `/garmin/ingest` (shared-secret auth). It only forwards data.
- **All mapping and reconciliation live in core** (`packages/core/src/import/garmin.ts`): one write path, PGlite-tested (ADR-004). Wellness merges into `daily_metrics` (measured wins, subjective preserved). Activities key on `source_ref = garmin:<activityId>`. A same-day conversational session is enriched in place. Unmatched cardio creates a session; unmatched strength is deferred, because per-set detail comes from conversational logging.
- The conversational check-in remains the permanent fallback.

## Alternatives Considered

### Manual export imports (ADR-013)
- Superseded: recurring friction.

### Official Garmin Health API
- Rejected: individuals can't apply, and the program is suspended.

### Paid aggregators (Terra, Spike)
- Rejected: B2B pricing, ≥$300/year.

## Consequences
- Backfill is a re-run with a wider window; idempotent merges (ADR-008) make re-runs safe.
- **Terms-of-service gray area**, accepted knowingly for personal single-account use. Garmin can break the protocol or invalidate sessions without notice. Recovery is a one-command local re-bootstrap.
- The MacroFactor import path disappeared at the same time (ADR-015).
- **Weigh-ins joined the sync on 2026-10-23** (ADR-026).
- **Hardening, 2026-10-24.** GitHub's scheduler silently stopped running the job for a week, and no failure email arrived because a run that never starts can't fail. Fixes:
  - worker calls are retried
  - crons moved off the top of the hour, with overlapping windows
  - a job timeout
  - a `garminSync` staleness signal in `get_daily_summary`

  Lesson: treat scheduled workflows as best-effort, and never rely on failure emails alone.

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §2 #8, §8.4, §11 #8; specs/06-garmin-weigh-ins/SPEC.md §2 #1 and IMPLEMENTATION.md "Post-launch hardening" @ specs-archive.
