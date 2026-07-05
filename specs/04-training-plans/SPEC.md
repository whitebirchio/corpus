# Training plans — epic spec

**Status:** Spec drafted 2026-07-05. Not yet implemented.
**Owner:** Scott Schmalz

## 1. Motivating context

Everything Corpus knows about training is backward-looking: workouts are logged after they happen, and "what should I do today?" (`plan_todays_workout`) re-derives an answer from scratch each morning with no memory of a strategy. There is nothing between a long-term goal and today's improvisation.

The real scenario driving this: the **"40-mile ultra at 40"** goal (target window March 2028 – March 2029) coexisting with 2×/week structured strength. Getting from ~15–20 mi/week today to a 40-mile finish is a multi-year progression that needs intermediate milestones (weekly-volume targets, tune-up races), a current training emphasis, and — most concretely — **a planned week of specific workouts** that adapts when life intervenes (sickness, weather, schedule).

This epic makes Corpus forward-looking. Consistent with the AI-agent-first architecture, **the planning intelligence is Claude, not Corpus**: MCP prompts encode the coaching playbook, tools persist and serve the plan, and Corpus additionally stores the structured context the agent needs to plan well — equipment on hand, capability estimates ("what should I be able to squat for 5"), and standing constraints ("no outdoor runs when it's 10°F"). Over time that context is *reinforced*: every planned-vs-actual comparison is an opportunity for the agent to refine its model of the athlete.

## 2. Decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | **The planning brain is Claude via MCP** — prompts + tools, no server-side LLM calls. | Consistent with the whole platform: features are MCP surface. Zero new infra/API cost; the agent that plans is the same one that knows the conversation context. A scheduled auto-draft (Workers cron + Claude API) stays in the backlog and layers on cleanly later since it would call the same core functions. |
| 2 | **Planned workouts live in their own tables (`planned_*`), not as flagged rows in `workout_sessions`.** A logged workout links back via `workout_sessions.planned_session_id`. | `workout_sessions` is the analytic record of what *happened*; every existing query, tool, and PWA payload assumes that. Mixing intents in would force status filters everywhere. Separate tables also let the plan model be shallower (see #3). |
| 3 | **Planned sessions are fully prescribed** (session → block → movement with sets × reps @ target load, or distance/duration/pace for cardio), **but there is no `planned_sets` table.** | Full prescription is what enables "anticipate how much weight I should use" and structural planned-vs-actual comparison. But prescriptions are uniform ("4×8 @ 61 kg") — per-set rows are a logging-time reality, not a planning-time one. Uniform fields on the planned movement row carry it. |
| 4 | **One plan per calendar week** (`training_weeks`, unique on `(user_id, week_start)`), drafted in a planning conversation near the end of the prior week and revised mid-week. | "This week's plan" always means exactly one thing — easy to reason about, natural-key upsert (idempotency tier 2), and a clean unit for adherence review. A rolling 7-day horizon was considered and rejected as harder to revise and reason about. |
| 5 | **Milestones are first-class rows (`goal_milestones`) linked to a goal; periodization is a light free-text `focus` on the week**, not a schema concept. | Milestones ("25 mi/week by Dec", "trail half spring 2027") are checkable and queryable, so they earn structure. Base/build/peak phases are agent strategy — encoding mesocycles as records would obligate the agent to keep them coherent for little query value. Revisit if phase-awareness in `query_data` is ever actually wanted. |
| 6 | **Planned↔actual linking is agent-mediated, never automatic.** The Garmin sync path is untouched; the agent reconciles imported sessions to the plan at the next interaction, and links conversationally-logged workouts at log time. | Matches the existing soft-match dedup philosophy (SPEC 01 §5.9 tier 3): records without stable identity get candidate-confirmation, not guesses. Keeps the one automated write path (Garmin) dumb and safe to re-run. |
| 7 | **Every mutation of a non-empty plan records a `plan_changes` row (category + summary), written in the same transaction by the same core function** — not a separate tool the agent could forget to call. | The adjustment history *is* training data for the reinforcement loop ("skipped 3 Fridays running" → suggest moving the rest day; "sick twice after poor sleep weeks" → back off sooner). Making it a side effect of mutation guarantees it exists. |
| 8 | **The athlete model is structured where computable, insights where fuzzy**: `equipment_items`, `capability_estimates`, `planning_constraints` tables + the existing `insights` mechanism. | Equipment and working maxes are enumerable and belong in queryable rows the agent can trust. "Tends to sandbag squat estimates" is prose and already has a home in insights. |
| 9 | **Weather/seasonality: Corpus stores location + seasonal constraints; the agent checks the live forecast itself** (web search) when planning. No weather API integration. | Zero infra for a signal the agent can fetch on demand. `users.home_location` (new nullable column) tells it where to look; `planning_constraints` rows like "no outdoor runs below −12°C" tell it what to do with the answer. |
| 10 | **Canonical metric storage applies to plans exactly as to logs**: target loads in kg, distances in m, paces in s/km. Tools accept `{ value, unit }`; core converts. | Invariant from SPEC 01. Planned-vs-actual comparison must never involve unit math by the LLM. |
| 11 | **`plan_week` replaces only *upcoming* sessions** (status `planned`) when re-planning an existing week; completed/skipped rows and their links are never clobbered. Surgical mid-week changes go through `update_planned_session`. | Re-planning Wednesday shouldn't erase the record that Monday happened and Tuesday was skipped. Wholesale replace of history would also orphan `workout_sessions` links. |
| 12 | **Capability estimates are current-belief rows, upserted on a natural key** — no estimate history table. | Progression history already exists in the actuals (`strength_sets`, run data); the estimate is just the agent's present belief with an `effective_date` and a `basis` citation. |
| 13 | **The athlete-model digest is a tool (`get_training_profile`), not an MCP resource**, unlike `corpus://profile`/`corpus://schema`. | MCP resources depend on client-side support to get surfaced into a conversation; Scott has observed this be flaky in practice. A planning conversation leans on the athlete model much harder than a one-off query leans on `corpus://schema`, so the silent-miss failure mode (plan drafted blind to equipment/constraints) is worse here — a tool is guaranteed-callable. |

## 3. Data model

All new tables follow the platform invariants: `user_id` denormalized onto every row for single-column RLS `ownerPolicy`, snake_case casing via Drizzle config, canonical metric units.

### 3.1 Strategy layer

```
goal_milestones  id, user_id, goal_id → goals (cascade), title,
                 description?, target jsonb ({ metric, target_value, unit, direction })?,
                 target_date?, status (reuses goal_status: active|paused|achieved|abandoned),
                 status_changed_at, notes
```

Milestones are ordered by `target_date` under their goal. Example chain for the ultra: *30 mi/week base (Dec 2026) → trail half-marathon (spring 2027) → 50k finish (spring 2028) → 40-miler (window 2028-03 … 2029-03)*.

### 3.2 The plan

```
training_weeks   id, user_id, week_start (date, the Monday), focus?, notes
                 -- UNIQUE (user_id, week_start) → natural-key upsert
                 -- `focus` is the light phase concept: "aerobic base + maintain strength"

planned_sessions id, user_id, week_id → training_weeks (cascade),
                 planned_date, title, status (planned|completed|skipped|cancelled),
                 status_changed_at, notes
                 -- UNIQUE (user_id, planned_date) → one planned session per day, no two-a-days

planned_blocks   id, user_id, planned_session_id (cascade), seq,
                 block_type (reuses block_type enum),
                 -- metcon prescription: scheme?, rounds_planned?, time_cap_s?, interval_s?,
                 -- cardio prescription: target_distance_m?, target_duration_s?,
                 --                      target_pace_s_per_km?, structure? (text, e.g.
                 --                      "5 × 3:00 @ RPE 6 / 2:00 jog"),
                 target_rpe?, notes

planned_block_movements
                 id, user_id, planned_block_id (cascade), movement_id → movements, seq,
                 sets?, reps?, reps_text? ("8-10", "21-15-9", "AMRAP"),
                 target_load_kg?, target_rpe?, rest_s?,
                 prescription? (display text, e.g. "4×8 @ 135 lb"), notes
```

Status semantics: `skipped` = didn't happen, decided after the fact (counts against adherence); `cancelled` = removed ahead of time by a deliberate re-plan (doesn't). `completed` is set when a logged workout is linked. Numeric fields are canonical; `prescription`/`reps_text` are display/irregular-scheme escape hatches — comparisons use the numbers.

One schema change to an existing table:

```
workout_sessions + planned_session_id? → planned_sessions (ON DELETE SET NULL)
users            + home_location? (text, e.g. "Exeter, NH" — for forecast lookups)
```

### 3.3 Adjustment history

```
plan_changes     id, user_id, week_id → training_weeks (cascade),
                 planned_session_id?, category
                 (sickness|injury|weather|schedule|fatigue|equipment|preference|progression|other),
                 summary (text, agent-written, e.g. "Moved Thu intervals to Fri;
                 felt run-down after poor sleep"), created_at
```

Append-only, written inside the same core transaction as the mutation it describes (decision #7). Initial creation of a week writes no change row.

### 3.4 Athlete model (the reinforcement substrate)

```
equipment_items  id, user_id, name, category
                 (barbell|dumbbell|kettlebell|rack|bench|band|machine|cardio|other),
                 details jsonb? ({ min/max load, increments, count, ... }),
                 location? ("garage", "gym"), active (bool), notes
                 -- UNIQUE (user_id, name); names should align with the movement
                 -- catalog's `equipment` vocabulary so feasibility is a join

capability_estimates
                 id, user_id, movement_id? → movements,
                 metric (text: 'working_load' | 'e1rm' for strength;
                 'weekly_run_volume' | 'long_run_distance' | 'zone2_pace' |
                 'threshold_pace' | ... for movement-less capacities),
                 rep_max? (int — value is an N-rep working estimate),
                 value (numeric, canonical unit), unit (kg|m|s|s_per_km|m_per_week),
                 confidence (reuses estimate_confidence: high|medium|low),
                 basis (text — provenance citation, e.g. "5×5 @ 84 kg on 2026-07-01, RPE 7"),
                 effective_date
                 -- natural key (user_id, movement_id, metric, rep_max), upserted;
                 -- implemented as partial unique indexes over nullable columns

planning_constraints
                 id, user_id, kind (schedule|injury|seasonal|equipment_access|preference|other),
                 rule (text, e.g. "No outdoor runs below about -12°C — treadmill instead",
                 "Long run Saturday mornings", "Left knee: no deep pistols until cleared"),
                 params jsonb?, active (bool), notes
```

Division of labor with insights (decision #8): constraints are standing *rules* the planner must respect; insights remain fuzzy *observations* ("underestimates RDL strength"). Both are loaded at planning time; only constraints are treated as binding.

## 4. MCP surface

### 4.1 Write tools

Thin shells over new core repos (`packages/core/src/repos/`), per the hexagonal invariant.

- `upsert_milestone` / `update_milestone_status` — mirrors the `upsert_goal` / `update_goal_status` pair. Tool description tells the agent to list existing milestones for the goal first (agent-mediated dedup).
- `plan_week` — create or re-plan a week: `week_start`, `focus`, and the full nested `sessions[]` payload (blocks → movements, unit-tagged loads). Upserts `training_weeks` on the natural key; replaces only `planned`-status sessions on re-plan (decision #11). When mutating a non-empty week, requires `change: { category, summary }`.
- `update_planned_session` — surgical mid-week change: move date, edit prescription (block/movement payload replace within the session), set status to `skipped`/`cancelled`, edit notes. Requires `change: { category, summary }`.
- `link_workout_to_plan` — set `workout_sessions.planned_session_id` and mark the planned session `completed` (or unlink). The reconciliation tool for both conversational logs and Garmin imports.
- `upsert_equipment_item`, `upsert_capability_estimate`, `upsert_planning_constraint` — athlete-model maintenance; each handles deactivation (`active: false`) rather than delete, preserving history.

### 4.2 Read tools & resources

- `get_training_plan` — args `{ week_start? }` (default: current week). Returns the week (focus, notes), its sessions with full prescriptions and status, linked actual-session summaries where completed, and the week's `plan_changes`. This is the "what's my plan" workhorse for both agent and (via core) the PWA.
- **`get_training_profile` tool** — the athlete model rendered for context-priming, sibling in spirit to the `corpus://profile` resource but a tool, not a resource: active milestones grouped by goal, capability estimates (with confidence + basis), active equipment, active constraints, home location, and the current week's focus. Planning prompts start by calling it. (Tool, not resource, by deliberate choice — decision #13. `corpus://profile` stays lean — identity + goals only.)

### 4.3 Prompts

New:

- `plan_my_week` — the weekly planning session (~5 min, typically Sunday). Call `get_training_profile` + `get_goals`; `get_training_plan` for the finishing week (adherence + what the change log says went wrong); `query_data` for recent volume (weekly mileage trend, per-muscle-group sets); `get_daily_summary` for recovery trend; check the forecast for `home_location` (web search) against seasonal constraints; then draft the week — respecting constraints and equipment, prescribing loads from capability estimates, progressing sensibly (e.g. ~10% mileage ramp, deload awareness), serving the nearest milestone. Present for confirmation, then `plan_week`.
- `adjust_my_plan` — args `{ what_happened }` ("woke up sick", "blizzard all week", "gym closed"). Read the current plan; propose the *minimal* adjustment that protects the week's key sessions (e.g. keep the long run, drop an accessory day); confirm; apply via `update_planned_session` with an honest change category. If the disruption looks recurring, propose a new `planning_constraint` or insight.
- `review_training_strategy` — the periodic (roughly monthly) strategist session: goal + milestone progress against actuals, milestone status updates or re-planning, next phase `focus`, and a sweep of capability estimates that look stale against recent performances.

Updated:

- `plan_todays_workout` — now starts from `get_training_plan`: if today has a planned session, the job is *execute-or-adapt* (scale to readiness, swap per constraints) rather than invent; only free-plans when nothing is scheduled.
- `log_workout_conversationally` — after saving, offer to link to today's planned session (`link_workout_to_plan`) and compare prescribed vs. actual.
- `weekly_review` — adds an adherence section: planned vs. completed/skipped, with `plan_changes` categories as the explanation layer.

## 5. Key flows

### 5.1 Weekly planning (Sunday, ~5 min)
`plan_my_week` → agent reviews finishing week + profile + forecast → proposes Mon–Sun with full prescriptions → user tweaks conversationally ("make Wednesday shorter") → `plan_week` saves. The plan is now visible to `get_training_plan`, the PWA, and tomorrow's `plan_todays_workout`.

### 5.2 Day-of execution
*"What's today?"* → today's planned session with prescriptions, sanity-checked against recovery data. Poor sleep/HRV → agent proposes scaling (same session, −10% loads) or swapping with an easier day, applied via `update_planned_session` (category `fatigue`).

### 5.3 Mid-week disruption
*"I'm sick, can't train today"* → `adjust_my_plan` → agent reshuffles the remaining days to protect key sessions, marks today `skipped` (category `sickness`), confirms the new shape of the week.

### 5.4 Post-workout reconciliation & reinforcement
Workout logged (conversation) or imported (Garmin, reconciled at next interaction) → `link_workout_to_plan` → agent compares prescribed vs. actual: *prescribed 4×8 @ 61 kg, did 4×8 @ 66 kg at RPE 7* → `upsert_capability_estimate` (new working_load, `basis` cites the session) → fuzzy learnings become insights; recurring friction becomes a constraint. This loop is the "gradually learns me" mechanism — no ML, just structured belief-updating with provenance.

### 5.5 Strategy checkpoint (monthly-ish)
`review_training_strategy` → milestone statuses updated, next block's `focus` chosen, stale estimates refreshed. Keeps the goal → milestone → week chain honest.

## 6. PWA additions (read-only, phase 3)

Per the epic-2 pattern (REST adapter calls the same core read functions; SPA stays a glanceable mirror):

- `GET /api/plan/week?start=YYYY-MM-DD` (default current week) → the `get_training_plan` payload.
- **Today view**: today's planned session card — title, block/prescription summary, status.
- **Week view**: seven day-chips (done / skipped / upcoming / rest) with tap-through to session detail.

All plan *changes* remain conversational; the PWA never writes (epic 2 invariant).

## 7. Idempotency & dedup (SPEC 01 §5.9 applied)

- `training_weeks`: natural-key upsert on `(user_id, week_start)` — tier 2.
- `capability_estimates`: natural-key upsert on `(user_id, movement_id, metric, rep_max)` — tier 2.
- `equipment_items`: unique `(user_id, name)` upsert — tier 2, with the agent calling `get_training_profile` first to check for an existing item.
- `goal_milestones`, `planning_constraints`: no stable natural key → agent-mediated (tier 3): tools' descriptions require listing existing rows before creating.
- Planned↔actual links: agent-mediated by design (decision #6); `link_workout_to_plan` is idempotent (re-linking the same pair is a no-op).

## 8. Non-goals / deferred

- **Scheduled auto-drafting** ("no plan by Sunday 6pm → draft one and notify"). Needs the backlog's proactive-briefings push channel + a server-side LLM call. This epic's core functions are the substrate; deliberately out of scope (decision #1).
- **Weather API integration in Corpus.** Agent-fetched forecasts only (decision #9).
- **Auto-matching imports to the plan in the Garmin sync path** (decision #6).
- **Schema-level periodization** (mesocycle records, multi-week templates) (decision #5).
- **Percent-of-max prescriptions** ("4×8 @ 70%"). Loads are prescribed absolute; the agent does percentage reasoning from capability estimates at planning time. Revisit if plans churn purely from estimate updates.
- **PWA plan editing** — would need the write-forward auth/mutation story from epic 2 §5; conversational editing is the product thesis anyway.
- **Estimate history / progression analytics on beliefs.** Actuals are the progression record (decision #12).

## 9. Build phases

1. **Plan core** — schema (`goal_milestones`, `training_weeks`, `planned_*`, `plan_changes`, `workout_sessions.planned_session_id`) + migrations; repos with PGlite tests (upsert-week semantics, decision #11 guard, change-log-in-transaction); tools `upsert_milestone`, `update_milestone_status`, `plan_week`, `update_planned_session`, `link_workout_to_plan`, `get_training_plan`; `plan_my_week` prompt v1 (plans from goals + history + forecast, before the athlete model exists).
2. **Athlete model & reinforcement** — `equipment_items`, `capability_estimates`, `planning_constraints`, `users.home_location`; upsert tools; `get_training_profile` tool; `adjust_my_plan` + `review_training_strategy` prompts; updates to `plan_todays_workout`, `log_workout_conversationally`, `weekly_review`.
3. **PWA plan views** — REST route + Today card + Week view.

Phase 1 alone is useful (plans exist, adherence is tracked); phase 2 is where "AI that knows me" compounds; phase 3 is glanceability.

## 10. Open questions

None outstanding.
