# ADR-023: Agent-mediated planned↔actual linking, an in-transaction change log, and a structured athlete model

## Status
Accepted

## Date
2026-07-05

## Context
Plans only become useful when they're reconciled against what happened and when the adjustments teach the agent something ("skipped 3 Fridays running" → move the rest day). Imported Garmin sessions have no notion of the plan. The agent also needs a durable model of the athlete: equipment, working maxes, and constraints such as "no outdoor runs below −12°C".

## Decision
- **Linking is agent-mediated, never automatic.** The Garmin sync path is untouched. The agent reconciles imported sessions to the plan at the next interaction, and links conversationally logged workouts at log time. This follows ADR-008's tier 3: records without stable identity get candidate confirmation, not guesses.
- **Every mutation of a non-empty plan writes a `plan_changes` row** (category + summary) **in the same transaction, by the same core function**. It isn't a separate tool the agent could forget to call.
- **The athlete model is structured where it's computable and stored as insights where it's fuzzy.** Structured: `equipment_items`, `capability_estimates` (ADR-022), `planning_constraints`. Fuzzy: the existing `insights` mechanism ("tends to sandbag squat estimates").

## Alternatives Considered

### Automatic linking in the Garmin import
- Rejected: it would make the one automated write path guess. It stays dumb and safe to re-run (ADR-014).

### A separate "log plan change" tool
- Rejected: the agent could forget to call it. A side effect of the mutation guarantees the history exists.

## Consequences
- The adjustment history *is* training data for the reinforcement loop.
- The agent must actively reconcile. Prompts (`morning_checkin`, the planning prompts) carry that responsibility.

---
Backfilled 2026-10-25 from specs/04-training-plans/SPEC.md §2 #6–8 @ specs-archive.
