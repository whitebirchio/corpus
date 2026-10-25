# ADR-010: Record granularity — hybrid nutrition, modality-aware workouts

## Status
Accepted

## Date
2026-07-01

## Context
Questions span both coarse adherence ("did I hit my macros?") and fine detail ("what weight did I use for pause front squats?", "what's driving my cholesterol?"). Input detail varies: sometimes a described meal or photo, sometimes just reported totals. Training mixes strength, runs and metcons, sometimes within one session.

## Decision
- **Nutrition: hybrid.** Itemize into `meal_items` (estimated macros, key micros, `estimate_confidence`) when the food is inferable; meal totals are then computed. Otherwise write a `totals`-granularity meal. `meals` totals are always populated either way.
- **Workouts: modality-aware detail.** Hierarchy session → block → block_movement → set. Blocks carry the modality, so one session can mix warmup, strength and metcon. Strength is per-set; runs carry distance, pace and HR; metcons are structured.

## Alternatives Considered

### Nutrition always item-level
- Rejected: forces itemizing when only totals are known.

### Nutrition totals only
- Rejected: no food-quality analysis.

### Workouts as session summaries
- Rejected: can't answer per-movement or per-set questions.

## Consequences
- Macro adherence works at any granularity. Food-quality analysis uses whatever itemized data exists.
- Per-set history makes per-movement questions answerable ("what weight did I use last time?").
- Strength detail comes from conversational logging; watch data only enriches it (ADR-014).

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §2 #5–6, §5.3, §5.4 @ specs-archive.
