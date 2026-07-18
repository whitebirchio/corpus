# Nutrition accuracy — implementation notes

**Built 2026-07-18** on branch `epic-05-nutrition-accuracy`, in two passes: phases 1–2 (protocol prompt, catalog + recipes + lookups, `lookup_barcode` MCP tool pulled forward) shipped and deployed earlier the same day (Neon migration applied, `FDC_API_KEY` set, catalog seeding begun); phase 3 (PWA barcode scanner) followed — see §Phase 3 below.

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

## Phase 3 — PWA barcode scanner (built 2026-07-18, second pass)

The PWA's first write surface, on the epic-2/3 write-forward path (the CSRF
middleware and resource-shaped routes were already waiting for it).

Worker (`apps/web/worker`):

- `nutrition.ts` — barcode-only fetch adapter (OFF → FDC Branded), the web twin of the MCP worker's; duplicated per the `db.ts` precedent (revisit on a third). Text search stays chat-side.
- `api.ts` — `GET /api/foods/barcode/:gtin` (catalog via `getFoodByBarcode` → external candidate → `not_found`), `POST /api/foods` (upsertFood; how an external hit becomes a catalog entry with the scanned barcode attached), `POST /api/meals` (core `logMeal` — same path as chat: server-side macro resolution, near-duplicate detection). Catalog foods serialize with per-portion macros precomputed server-side.
- `FDC_API_KEY` (optional secret) added to the web worker's Env; set it with `npx wrangler secret put FDC_API_KEY` in `apps/web` too.

Client (`apps/web/src`):

- `views/Scan.tsx` — lazy-loaded 4th tab. Camera via `getUserMedia`, decoding via the `barcode-detector` ponyfill (zxing-wasm; iOS Safari has no native `BarcodeDetector`). Flow: detect EAN/UPC → lookup → confirm card (portion picker + ½-step quantity stepper, meal type inferred from time of day) → log → summary. External hits offer "Save to catalog & log" (FDC saves `verified`, OFF unverified); unknown barcodes point back to chat + label photo. `possible_duplicate` renders the candidates with an explicit "Log anyway" (`allowDuplicate`).
- The zxing wasm (~1 MB) is bundled as a hashed asset (no CDN fetch) but excluded from the SW precache (`globIgnores`) and runtime-cached on first scan instead — install download stays at ~656 KiB. `zxing-wasm` is pinned exactly to the version `barcode-detector` pins, so the bundled asset can never drift from the decoder runtime.

Verified: OFF v2 response shape checked live (which surfaced that OFF sends explicit `null`s — `normalizeOffProduct` now treats null like absent rather than coercing to 0, with a regression test); routes probed on `wrangler dev` (mounted, 401-gated). NOT yet verified: the authenticated camera→scan→log loop on a real phone — needs Scott's sign-in.

## Manual steps

Phases 1–2 (all done 2026-07-18): Neon migration 0004 applied; MCP worker `FDC_API_KEY` set; merged to main and CI-deployed; catalog seeding begun (Ascent whey first).

Phase 3, remaining:

1. `npx wrangler secret put FDC_API_KEY` in `apps/web` (the web worker has its own secret store; without it, barcode fallback is OFF-only) — and add it to `apps/web/.dev.vars` for local dev.
2. On-phone smoke test after deploy: sign in, Scan tab, scan the Ascent bag (should hit the catalog entry seeded earlier), a packaged item not in the catalog (external → save & log), and any produce sticker (not_found path).
3. Continue the seed session for the remaining staples.
