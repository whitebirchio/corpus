# Record edits — epic spec

**Status:** Shipped 2026-07-03. Meals: edit + delete. Workouts: delete + session-level edit (via MCP).
**Owner:** Scott Schmalz

## 1. Motivating context

Corpus could log meals and workouts but had no way to **correct or remove** a record: a meal entered with the wrong macros, or logged twice, was stuck that way, and the same gap existed for workouts. This epic adds edit/delete to the conversational MCP surface — the first *writes-that-mutate* on the platform.

This was designed for ahead of time in [specs/02-pwa-client/SPEC.md §5](../02-pwa-client/SPEC.md) ("Write-forward guardrails"): daily macro totals are derived on read (`getDayNutrition` sums the day's `meals`), records carry a stable `id` + `source`, and children cascade-delete — so edit/delete slots in without schema change. The PWA read payloads already expose `id`/`source`, and the REST routes are shaped so `PATCH`/`DELETE` slot in later.

## 2. Decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | **Only `source = "conversation"` records are editable/deletable.** Imported records (`garmin_export`, `macrofactor_export`, `document_extraction`, `checkin`) return `not_editable`. | Editing/deleting an imported record collides with the idempotent importers: a re-sync resurrects a deleted Garmin activity, a re-import overwrites an edit. Same call as PWA SPEC §2 #11. Enforced in core, not just the adapter. |
| 2 | **Meals get full edit** (scalar fields, date/time, and macros via item-replace or direct totals) **+ delete.** | The concrete pain: a wrong AI macro estimate, or a duplicate meal. |
| 3 | **Workouts get delete + session-level field edit** (title, date/time, RPE, duration, HR, calories, notes) via MCP. Blocks/movements/sets are **not** editable in place — to fix reps/weights, delete and re-log. | A mis-entered workout is usually re-logged wholesale; arbitrary nested editing is a large, error-prone tool surface for little conversational gain. Full nested edit is deferred to a future PWA phase (direct-manipulation UI), where it fits naturally. |
| 4 | **Structured status unions, not thrown errors** — `updated` / `deleted` / `not_found` / `not_editable`. | Mirrors the existing `LogMealResult` / `LogWorkoutResult` dedup pattern; the agent gets an actionable result to surface, not an exception string. |
| 5 | **Editing macros: `items` replaces the item list and recomputes totals; `totals` sets them directly and drops items.** Sending both is rejected at the schema layer. | Keeps `totals` authoritative and unambiguous — no half-itemized, half-overridden state. Matches `logMeal`'s hybrid-granularity rule (SPEC 01 §5.4). |

## 3. Surface

Core (`packages/core`, PGlite-tested — where the logic and guard live):
- `meals.ts`: `updateMeal(db, ctx, UpdateMealInput)`, `deleteMeal(db, ctx, mealId)`.
- `workouts.ts`: `updateWorkout(db, ctx, UpdateWorkoutInput)`, `deleteWorkout(db, ctx, sessionId)`.
- Each loads the target row scoped by `user_id` (belt-and-braces with RLS), refuses non-`conversation` `source`, then mutates in a transaction. Meal item-replace and delete rely on `meal_items` / `workout_blocks → block_movements → strength_sets` `ON DELETE CASCADE`.

MCP tools (`apps/mcp-server/src/tools.ts`, thin shells): `update_meal`, `delete_meal`, `update_workout`, `delete_workout`. Tool descriptions tell the agent where to get the `id` (`get_daily_summary` → `nutrition.meals[].id`; `get_recent_workouts` → `session.id`, also now `get_daily_summary` → `recentWorkouts[].sessionId`), to confirm before a destructive delete, and that imports return `not_editable`.

Read-side: `getDailySummary`'s `recentWorkouts` now carries `sessionId` so a workout seen in the morning briefing is directly addressable for edit/delete.

## 4. Non-goals / deferred

- **In-place editing of workout blocks / movements / sets.** Deferred to a future PWA direct-manipulation phase (decision #3).
- **Editing/deleting imported or synced records.** Still out of scope; needs a tombstone/override concept in core (PWA SPEC §2 #11) — revisit only on a real use case.
- **PWA `PATCH`/`DELETE` routes.** The REST adapter stays GET-only for now; the core functions it will call already exist and are tested, so the later phase is adapter-only.
