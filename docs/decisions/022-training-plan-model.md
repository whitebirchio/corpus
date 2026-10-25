# ADR-022: Training plans — separate `planned_*` tables, one plan per calendar week

## Status
Accepted

## Date
2026-07-05

## Context
`workout_sessions` is the analytic record of what *happened*; every existing query, tool and PWA payload assumes that. Plans need full prescriptions ("4×8 @ 61 kg"), so the agent can anticipate loads and compare planned vs. actual structurally. Plans also get revised mid-week, and history must not be clobbered.

## Decision
- **Separate tables** (`planned_*`), not flagged rows in `workout_sessions`. A logged workout links back via `workout_sessions.planned_session_id` (ADR-023).
- **Fully prescribed sessions** (session → block → movement with sets × reps @ target load, or distance/duration/pace), **but no `planned_sets` table**. Prescriptions are uniform, so uniform fields on the planned movement row carry them; per-set rows are a logging-time reality.
- **One plan per calendar week** (`training_weeks`, unique on `(user_id, week_start)`, Monday start), drafted near the end of the prior week and revised mid-week. This is a natural-key upsert (ADR-008).
- **Re-planning replaces only upcoming sessions** (status `planned`). Completed and skipped rows and their links are never clobbered; surgical changes go through `update_planned_session`.
- **Milestones are first-class rows** (`goal_milestones`, linked to a goal). Periodization is free-text `focus` on the week, not a schema concept.
- **Capability estimates are current-belief rows**, upserted on a natural key (`UNIQUE NULLS NOT DISTINCT`), with an `effective_date` and a `basis` citation. There is no estimate history table.
- Units are canonical, exactly as for logs (ADR-007).

## Alternatives Considered

### Plans as flagged `workout_sessions` rows
- Rejected: mixing intents forces status filters everywhere.

### A rolling 7-day horizon
- Rejected: harder to revise and reason about than "this week's plan".

### Mesocycles/phases encoded as records
- Rejected: they would oblige the agent to keep them coherent for little query value. Revisit if phase awareness in `query_data` is ever wanted.

### An estimate history table
- Rejected: progression history already exists in the actuals (`strength_sets`, run data).

## Consequences
- **No two-a-days:** sessions are unique on `(user_id, planned_date)`.
- **Mistaken skips can be undone.** `plan_week` refuses dates held by non-`planned` sessions, so `update_planned_session` accepts `status: "planned"` as the undo path (added during build). Completed sessions must be unlinked first.
- **Refusals are structured statuses** (`invalid_dates`, `change_required`), following ADR-020.
- **Plans are part of the daily surfaces:**
  - `get_daily_summary` returns `todaysPlan`
  - `get_goals` returns milestones inline
  - `morning_checkin` is plan-aware

---
Backfilled 2026-10-25 from specs/04-training-plans/SPEC.md §2 #2–5, #10–12, §3 and IMPLEMENTATION.md "Deviations" and "Cohesion pass" @ specs-archive.
