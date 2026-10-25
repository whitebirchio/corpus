# ADR-027: All nutrition targets are maxima, protein included

## Status
Accepted

## Date
2026-10-24

## Context
The PWA Today view showed calories as a hero number and protein/carbs/fat as always-blue bars that clamped at 100%. A bar couldn't show that you were close to, or past, the day's limit. Adding status colors meant deciding what each target *means*: a ceiling, or (for protein) a floor to reach.

## Decision
Treat **every** target as a **maximum**: calories, protein, carbs and fat. Status comes from the raw ratio `value / target`:
- **under:** below 0.90 (blue)
- **near:** 0.90 to 1.00 inclusive (amber)
- **over:** above 1.00 (red)

One constant (`WARN_RATIO`) holds the threshold. "Over" is also stated in text ("22 g over"), so color is never the only cue (WCAG 1.4.1).

## Alternatives Considered

### Protein as a floor that turns green on reaching target
- Considered and rejected for now.

### Per-macro floor/max flags on `nutrition_targets`
- Considered and rejected for now.

## Consequences
- Don't "fix" protein into a floor without asking. It was Scott's explicit call.
- Light-mode amber `#a86a00` reads mustard, but it's the lightest amber that keeps 3:1 contrast against the pale-blue track (WCAG 1.4.11). Scott confirmed it live and kept it (2026-10-24).

---
Backfilled 2026-10-25 from specs/07-macro-meters/SPEC.md §1, §9 @ specs-archive.
