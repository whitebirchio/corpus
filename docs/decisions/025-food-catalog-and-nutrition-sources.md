# ADR-025: Personal food catalog plus USDA FDC / Open Food Facts, with agent-confirmed matches

## Status
Accepted

## Date
2026-07-18

## Context
**Corpus replaces MacroFactor** as the sole nutrition logger, so the gaps MacroFactor covered (a verified food database, barcode scanning) must close in-system. The first 81 conversationally logged meals (2026-07-02 → 07-18) showed two compounding problems:
- **Name fragmentation:** one whey protein appeared under six names at 110–240 kcal per entry.
- **Portion vagueness:** ~55% of portions were household volumes, ~25% counts and ~15% weights.

No meal had a photo attached despite the infrastructure existing.

## Decision
- **Quantities stay mixed.** Catalog foods carry a portion→gram map, so the *server* converts portion → grams → macros (extending ADR-007). The LLM stops doing macro math for catalog foods.
- **Photos always come with a caption.** They serve both to identify items and to cross-check portions. Photo-only logging is out of scope.
- **A personal food catalog plus saved recipes**, per-user and RLS-owned (ADR-006). It's demand-driven and small, and its aliases reflect how Scott names foods.
- **External data:** USDA FoodData Central, specifically:
  - Foundation/SR Legacy for generic foods
  - FNDDS for mixed dishes with household portions
  - Branded by UPC

  Plus Open Food Facts for barcode-first lookup. Both are free.
- **Resolution is agent-mediated.** Lookup tools return *candidates*, and the agent confirms with the user before binding a food (ADR-008, tier 3). A wrong silent match would poison every future log of that alias.
- **"Couldn't match" never blocks a log.** The meal falls back to the agent's estimate at `low` confidence, and the weekly review sweeps repeated low-confidence items into catalog candidates.
- **External calls sit behind a core port** (`NutritionSource`), implemented as fetch adapters in the workers (ADR-004).

## Alternatives Considered

### A mirrored global food database
- Rejected in favor of a small, verified, personal catalog. About 30 staples cover most logged items.

### Nutritionix / Edamam
- Rejected: free tiers too restrictive.

### MyFitnessPal
- Rejected: no API.

### Photo-only logging
- Out of scope: captions resolve what vision can't (hidden ingredients, prep method).

## Consequences
- Tools: `search_foods`, `upsert_food`, `save_recipe`, `get_recipe` (added during build, so the agent hands log-ready items to `log_meal` without doing math), and `lookup_barcode`.
- Barcode lookup landed in core and MCP first. The PWA's Scan tab is a client of the same path (ADR-016), with resolution order catalog → OFF → FDC. Open Food Facts sends explicit `null`s, which normalization treats as absent rather than 0.
- What persists for a catalog-resolved item is `grams_resolved`. `portionLabel` is an input only.
- The barcode fallback needs `FDC_API_KEY` set on *each* worker.

---
Backfilled 2026-10-25 from specs/05-nutrition-accuracy/SPEC.md §1, §2 #1–8 and IMPLEMENTATION.md "Deviations" and "Phase 3" @ specs-archive.
