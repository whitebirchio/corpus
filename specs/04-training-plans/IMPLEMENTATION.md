# Training plans — implementation notes

Built 2026-07-05, all three phases in one pass (commits: plan core → athlete model → PWA views). This records where implementation deviated from or refined [SPEC.md](SPEC.md); everything not mentioned landed as specced.

## Deviations & refinements

- **`get_goals` now returns each goal's milestones inline** (tool layer composes `getActiveGoals` + `getMilestones`; core functions unchanged). The spec had milestones surfacing only via `get_training_profile` — but the upsert-milestone dedup guidance ("list existing milestones first") needed a phase-1 read path, and goal + checkpoints in one payload is strictly better context.
- **`set_home_location` tool added** (spec §4.1 updated in place) — `users.home_location` needed a conversational writer.
- **`update_planned_session` accepts `status: "planned"`** as an undo path for a mistaken skip/cancel. Without it, a skipped session was unrecoverable: `plan_week` refuses dates held by non-`planned` sessions (decision #11), so nothing could revive the day. Completed sessions still require unlinking first.
- **`plan_week` refusal statuses** are `invalid_dates { problems[] }` (non-Monday weekStart, out-of-window or duplicate dates, collision with a kept session) and `change_required { existingSessions[] }` — mirroring the `LogWorkoutResult` structured-union pattern rather than the bare strings sketched in §4.1.
- **`capability_estimates` natural key** is a single `UNIQUE NULLS NOT DISTINCT` constraint (PG15+; Neon and PGlite both support it), not the partial-index pair mused about in §3.4.
- **Capability estimate input** is `estimate: { value, unit }` with a wide unit enum (lb/kg, mi/km/m, min/mi, mi-per-week, …) canonicalized in core (`toCanonicalEstimate`) — the general unit-tagged-value invariant applied to a multi-quantity field.

## Verification status

- Core: PGlite suites cover plan CRUD/re-plan semantics, change-log-in-transaction, linking (incl. re-link/unlink status reverts), milestones, equipment/capability/constraint upserts, and the profile aggregate (`test/training-plans.test.ts`, `milestones.test.ts`, `athlete.test.ts`).
- Migrations `0002` + `0003` applied cleanly to PGlite (every test run) — **not yet applied to the Neon dev branch or prod**: the `.dev.vars` `DATABASE_URL` is the restricted runtime role, and the owner connection string lives only in the Neon console. Run `npm run db:migrate -w @corpus/core` with the owner URL (dev branch first, prod before deploying).
- Layer 3 (wrangler dev + MCP Inspector) and the PWA views need an interactive session (Google OAuth) — untested at build time.
