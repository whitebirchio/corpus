# Nutrition accuracy — epic spec

**Status:** Phase 1 (photo + caption estimation protocol) shipped 2026-07-18. Phases 2–3 designed, not built.
**Owner:** Scott Schmalz

## 1. Motivating context

Meal logging works but is imprecise, and the imprecision compounds in two specific ways (measured against the first 81 conversationally-logged meals, 2026-07-02 → 2026-07-18):

- **Name fragmentation**: the same staple is re-estimated from scratch under many spellings — the Ascent vanilla whey appears under *six* names logging anywhere from 110 to 240 kcal per entry, beet root extract under three, "Spinach" vs "Fresh spinach". There is no memory of what a food *is*.
- **Portion vagueness**: ~55% of item portions are household volumes ("1 cup", "2 tbsp"), ~25% counts ("1 scoop", "2 slices"), ~15% weights, plus a vague tail ("3 ribs", "small amount"). Typical `estimate_confidence` is `medium`; nothing tightens it over time.

Zero meals have a photo attached despite the epic-1 infrastructure (`meals.photo_document_id`, `meal_photo` document kind, `create_document_upload`) existing.

The decision that frames the whole epic: **Corpus replaces MacroFactor** as the sole nutrition logger. That means the accuracy and convenience gaps MacroFactor covered (verified food database, barcode scanning) must close in-system, and the `meals.source_ref` MacroFactor-import path anticipated by SPEC 01 is deprioritized (retained only for a possible one-time historical backfill).

Goal: label/database-grade macros for repeated foods, honest uncertainty for everything else, and logging effort that stays flat or drops.

## 2. Decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | **Quantities stay mixed** — household measures usually, exact gram weights occasionally. Catalog foods carry a portion→gram map so the *server* converts. | Matches observed behavior (55% volumes). Accuracy must improve without changing entry habits. Extends the SPEC 01 canonical-units invariant: the LLM never does unit math — and after phase 2, it stops doing *macro* math for catalog foods too. |
| 2 | **Photos always come with a caption** and serve two roles: input (identify items) and sanity-check (portion cross-check). Photo-only logging is out of scope. | User preference; captions collapse the worst ambiguity (hidden ingredients, prep method) that vision alone can't resolve. |
| 3 | **Personal food catalog + saved recipes**, per-user and RLS-owned — not a mirrored global food DB. | ~30 staples cover most logged items; a demand-driven catalog stays small, verified, and personal (aliases reflect how *Scott* names foods). Recipes make repeated homemade meals ("my protein smoothie") one utterance. |
| 4 | **Data sources: USDA FoodData Central + Open Food Facts.** FDC (free api.data.gov key): Foundation/SR Legacy for generic foods, FNDDS for mixed "as eaten" dishes with household-portion gram weights, Branded for label data keyed by UPC. OFF (free, no key): barcode-first packaged-goods lookup. | Both free ($0 added cost), stable, and complementary: FDC is authoritative for generic + US-branded, OFF has the barcode-first API shape. Nutritionix/Edamam free tiers are too restrictive; MyFitnessPal has no API. |
| 5 | **Agent-mediated food resolution**: lookup tools return *candidates*; the agent confirms with the user before binding a food. | Mirrors dedup tier 3 (SPEC 01 §5.9) — for records with no stable identity, the agent confirms rather than the server guessing. A wrong silent match poisons every future log of that alias. |
| 6 | **"Couldn't match" never blocks a log.** Fall back to the agent's estimate at `low` confidence; the weekly review sweeps repeated low-confidence items into catalog candidates. | Logging friction is the failure mode that kills tracking habits. Accuracy debt is repaid asynchronously, not at meal time. |
| 7 | **Barcode lookup lands in core + MCP first; the PWA scanner UI is a client of it.** | CLAUDE.md rule: never a PWA-only capability. A UPC typed or photographed in chat resolves through the same path as a camera scan. |
| 8 | **External nutrition-DB calls live behind a core-defined port, implemented as fetch adapters in the workers.** Core gets a `NutritionSource` interface + pure normalization/ranking logic (fixture-tested in PGlite/vitest); the FDC/OFF HTTP clients are thin adapter files. | Preserves the hexagonal rule that `@corpus/core` has no HTTP dependencies while keeping all matching/normalization logic in the testable layer. |

## 3. Phase 1 — photo + caption protocol (shipped 2026-07-18)

No schema change. One new MCP prompt, `log_meal_conversation` (`apps/mcp-server/src/prompts.ts`), codifying the estimation protocol:

- Itemize every component **including the easy-to-miss ones** (cooking fat, dressings, sauces, cheese, beverages); verbatim portions in `unitNote`; exact weights used as-given.
- Photo used both to spot unmentioned items and to cross-check stated portions; **at most one clarifying question**, only when photo and caption disagree >~25% on a calorie-dense item.
- Honest per-item `estimateConfidence` (`high` = label/weighed, `medium` = solid visual, `low` = guess); key micros (fiber, sugar, sat fat, sodium) when inferable.
- Consistent item naming against history (checking recent `meal_items` via `query_data` when unsure) — the manual bridge until phase 2 aliases exist.
- Meal-level plausible calorie range in `notes` when confidence is medium or lower (e.g. "~620 kcal, plausible 520–750").
- Recap totals + day-vs-targets after saving; surface `possible_duplicate` candidates instead of retrying.

User-side photo habits (documented here, enforced nowhere): shoot ~45° (depth is invisible from directly overhead), whole plate in frame with a scale reference, before eating; photograph smoothie *ingredients*, not the finished cup.

Photo **storage** stays optional until the upload-ergonomics backlog item lands — photos shared in-chat are the operative input; `photo_document_id` attach is a bonus when a document was archived.

**Expected outputs per meal:** itemized kcal/protein/carbs/fat + tracked micros, per-item confidence, meal totals, plausible range on uncertain meals. Realistic accuracy ±20–30% per meal, tighter on daily totals.

## 4. Phase 2 — food catalog, recipes, structured lookups (designed)

### 4.1 Data model

- **`foods`** (user-owned, RLS `ownerPolicy` like every other table): `canonical_name`, `brand`, `aliases text[]`, `barcode` (GTIN/UPC, nullable), per-100g `calories` / `protein_g` / `carbs_g` / `fat_g` + `micros jsonb`, `portions jsonb` (`[{label: "1 scoop", grams: 31}, ...]`), `source` enum (`label` | `fdc` | `off` | `estimate`), `source_ref` (fdcId / OFF code), `verified boolean`, timestamps. Dedup keys: unique `(user_id, lower(canonical_name))`; unique `(user_id, barcode)` where barcode is not null.
- **`recipes`** + **`recipe_items`**: name, aliases, servings; items reference `food_id` + grams. Per-serving totals derived on read (same derive-don't-store posture as day nutrition totals).
- **`meal_items`** gains nullable `food_id` and `grams_resolved` — an item logged against a catalog food records exactly which food and how many grams the server resolved.

### 4.2 Resolution flow & tool surface

- **`search_foods(query)`** — catalog alias match first (exact, then fuzzy); on miss, live FDC + OFF search via the `NutritionSource` port. Returns ranked candidates with per-portion macros for agent-mediated confirmation (decision 5).
- **`upsert_food`** — create/verify a catalog entry from a nutrition-label photo or a chosen DB candidate; merges new aliases into an existing food rather than duplicating.
- **`save_recipe`** — snapshot a confirmed itemized meal as a reusable recipe.
- **`log_meal`** items additionally accept `foodId` + quantity/portion label; **core** resolves portion → grams → macros. The agent picks the food and portion; the server does the arithmetic.

### 4.3 Seeding

One conversational session: photograph the labels of the ~30 staples, create `verified` entries, and attach historical aliases (a `query_data` sweep over distinct `meal_items.name` provides the alias list). Re-runnable safely via the natural keys above.

### 4.4 Expected outputs

Staples become exact: label-verified macros at `high` confidence, portion conversion handled server-side. Unmatched foods follow decision 6 — logged immediately at `low` confidence, surfaced weekly as catalog candidates.

## 5. Phase 3 — PWA barcode scanning (designed)

- **`lookup_barcode(gtin)`** in core (via the `NutritionSource` port) + as an MCP tool. Resolution order: personal catalog → Open Food Facts → FDC Branded.
- **PWA scanner** — the PWA's first write surface, following the write-forward path epic 3 established. Camera via `getUserMedia`; decoding via **zxing-wasm** (or the `barcode-detector` polyfill over it), because the native `BarcodeDetector` API doesn't exist in iOS Safari. Flow: scan → `GET /api/foods/barcode/:gtin` → confirm serving count (default 1, quick ½/2 adjusters) → `POST /api/meals` through the same `logMeal` repo path — near-duplicate detection applies unchanged.
- **Unknown barcode**: prompt for a nutrition-label photo (or defer to chat), `upsert_food` with the barcode attached — the next scan of that item is instant.
- **Secrets**: FDC API key as a worker secret on both workers; OFF needs none.

**Expected outputs:** label-exact macros at `high` confidence, meal type inferred from time of day, a few seconds per packaged item — the piece that makes dropping MacroFactor stick (targets and summaries already exist via `nutrition_targets` / `get_daily_summary`).

## 6. Idempotency & dedup (SPEC 01 §5.9 applied)

- `foods`: natural-key upserts on `(user_id, lower(canonical_name))` and `(user_id, barcode)`; alias merges are additive. The seed session is re-runnable.
- Food *binding* is tier-3 agent-mediated (decision 5): candidates surfaced, never silently guessed.
- Meals logged via barcode or catalog go through the existing `log_meal` near-duplicate detection unchanged.

## 7. Non-goals / deferred

- Mirroring FDC/OFF into a local global food database — the catalog is demand-driven and personal.
- Micronutrient completeness beyond the tracked micros set.
- MacroFactor historical import (path retained in schema; build only if ever wanted).
- Offline barcode decoding/database in the PWA; photo-only (caption-less) meal inference.
- Automatic portion estimation from photo pixel geometry — the agent estimates; no CV pipeline.

## 8. Build phases

1. **Phase 1 — protocol prompt** (this ship): `log_meal_conversation` prompt; no schema change.
2. **Phase 2 — catalog + recipes + lookups**: schema (`foods`, `recipes`, `meal_items` additions) + migration, repos + Zod schemas + PGlite tests (fixture-tested FDC/OFF normalization), `NutritionSource` port + worker adapters, tools (`search_foods`, `upsert_food`, `save_recipe`, extended `log_meal`), seed session.
3. **Phase 3 — barcode**: `lookup_barcode` core + MCP tool, REST routes (`GET /api/foods/barcode/:gtin`, `POST /api/meals`), PWA scanner page.

## 9. Open questions

- Whether the meal-level plausible range deserves structured columns (`kcal_low` / `kcal_high`) instead of the notes convention — decide in phase 2 when summaries could surface uncertainty bands.
- FNDDS household-portion labels are inconsistent; the portion→gram map may need a small curated overlay for the most common measures (cup / tbsp / scoop / slice).
- Whether `search_foods` live lookups should cache FDC/OFF responses (KV, short TTL) to stay inside rate limits — likely unnecessary at single-user volume.
