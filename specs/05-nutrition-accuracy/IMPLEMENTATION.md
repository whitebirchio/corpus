# Nutrition accuracy — implementation notes

**Built 2026-07-18** on branch `epic-05-nutrition-accuracy`: phase 1 (protocol prompt) and phase 2 (catalog + recipes + lookups), plus the `lookup_barcode` MCP tool pulled forward from phase 3. Remaining: manual steps below, then phase 3's PWA scanner UI.

## What landed

Core (`packages/core`):

- Schema (`drizzle/0004_amazing_richard_fisk.sql`): `food_source` enum; `foods` (per-100g macros, `aliases text[]`, `portions jsonb`, partial-unique barcode, expression-unique `lower(canonical_name)`); `recipes` + `recipe_items`; `meal_items.food_id` (FK `SET NULL`) + `grams_resolved`. RLS `owner_only` on all three new tables.
- `repos/foods.ts` — `upsertFood` (natural-key match barcode → name → alias, additive alias merge, rename demotes old canonical name to alias), `searchFoodsCatalog` (exact > prefix > substring over names/aliases/brand; verified wins ties), `getFoodByBarcode`, `getFoodsByIds`, and the pure math: `resolveGrams` (explicit grams > portion-label match — "scoop"/"1 scoop"/"Scoops" all hit the same portion — × quantity) and `macrosForGrams`.
- `repos/recipes.ts` — `saveRecipe` (create-or-replace by lower(name), items must reference existing foods), `expandRecipe` (fuzzy find, scale to servings eaten, server-computed macros + totals).
- `repos/meals.ts` — `logMeal`/`updateMeal` now run items through `resolveCatalogItems`: a `foodId` item gets server-computed macros (overriding agent estimates) and `grams_resolved`; unresolvable grams fall back to agent macros (decision #6); unknown `foodId` throws.
- `schemas/foods.ts` (new inputs) + `mealItemInput` gains `foodId`/`grams`/`portionLabel`.
- `nutrition/` — `NutritionSource` port types + pure `normalizeFdcFood` / `normalizeOffProduct` (fixture-tested; sodium g→mg for OFF, kcal-required, mass-based servings only).

Worker (`apps/mcp-server`):

- `src/nutrition.ts` — fetch adapters: FDC `/v1/foods/search` (Foundation, SR Legacy, FNDDS, Branded; needs `FDC_API_KEY`), OFF search + `/api/v2/product/{gtin}`. 6 s timeouts; failures degrade to empty results, never block a log.
- New tools in `tools.ts`: `search_foods` (catalog first; skips network when the query is an exact catalog hit), `upsert_food`, `save_recipe`, `get_recipe`, `lookup_barcode` (catalog → OFF → FDC Branded). `log_meal` description now teaches the `foodId` path.
- `corpus://schema` doc updated; `log_meal_conversation` prompt (phase 1, same epic) updated in place to route through the catalog.

Tests: `foods`, `recipes`, `meals-catalog`, `nutrition-normalize` (+20; suite at 159).

## Deviations from SPEC

1. **`lookup_barcode` pulled forward from phase 3** — decision #7 said core+MCP first; the adapter was 90% shared with `search_foods`, so phase 3 is now purely the PWA scanner UI + REST routes.
2. **`get_recipe` tool added** (§4.2 listed only `save_recipe`) — the agent needs the expansion server-side to hand log-ready items to `log_meal` without doing math.
3. **`portionLabel` is a log-input field, not a column** — resolution inputs are `foodId` + (`grams` | `portionLabel` × `quantity`); what persists is `grams_resolved`.
4. **Per-100g column names** came out as `calories_per100g` etc. via drizzle's casing (not `calories_per_100g`).

## Manual steps before merge/deploy

1. **Neon migration**: `npm run db:migrate -w @corpus/core` against a dev branch first, then prod (`drizzle/0004_amazing_richard_fisk.sql`).
2. **Optional but recommended**: get a free api.data.gov key and `npx wrangler secret put FDC_API_KEY` in `apps/mcp-server` (also add to `.dev.vars` for layer 3). Without it, external search is OFF-only.
3. **Layer-3 smoke test**: `npm run dev` + MCP Inspector → `search_foods` ("ascent whey"), `upsert_food`, `log_meal` with `foodId`, `get_recipe`, `lookup_barcode`.
4. **Seed session** (conversational, after deploy): photograph labels of the ~30 staples; create verified entries; attach historical aliases from a `query_data` sweep of distinct `meal_items.name`.
