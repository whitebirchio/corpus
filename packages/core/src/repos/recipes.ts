/**
 * Saved recipes (specs/05-nutrition-accuracy/SPEC.md §4.1): reusable composite
 * meals whose items reference catalog foods by grams. Per-serving totals are
 * derived on read — never stored — mirroring how day nutrition is summed.
 */
import { and, eq, ilike, or, sql } from "drizzle-orm";
import type { Db, UserCtx } from "../db/client.js";
import { recipeItems, recipes } from "../db/schema.js";
import type { SaveRecipeInput } from "../schemas/foods.js";
import { getFoodsByIds, macrosForGrams, type FoodMacros } from "./foods.js";

export type Recipe = typeof recipes.$inferSelect;
export type RecipeItem = typeof recipeItems.$inferSelect;

export interface RecipeDetail {
  recipe: Recipe;
  /** One entry per recipe item, grams scaled to the requested servings. */
  items: Array<{ foodId: string; name: string; grams: number; macros: FoodMacros }>;
  /** Totals for the requested servings. */
  totals: FoodMacros;
  servingsRequested: number;
}

export type SaveRecipeResult = { status: "created" | "updated"; recipe: Recipe };

/**
 * Create-or-replace by case-insensitive name: an existing recipe's item list
 * is replaced wholesale (same posture as updateMeal's item-replace). Every
 * referenced food must exist in the catalog.
 */
export async function saveRecipe(
  db: Db,
  ctx: UserCtx,
  input: SaveRecipeInput,
): Promise<SaveRecipeResult> {
  const foodsById = await getFoodsByIds(
    db,
    ctx,
    input.items.map((i) => i.foodId),
  );
  const missing = input.items.filter((i) => !foodsById.has(i.foodId));
  if (missing.length > 0) {
    throw new Error(
      `unknown catalog food id(s): ${missing.map((m) => m.foodId).join(", ")} — use search_foods / upsert_food first`,
    );
  }

  const lname = input.name.trim().toLowerCase();
  return db.transaction(async (tx) => {
    const existing = (
      await tx
        .select()
        .from(recipes)
        .where(
          and(eq(recipes.userId, ctx.userId), sql`lower(${recipes.name}) = ${lname}`),
        )
    )[0];

    let recipe: Recipe;
    if (existing) {
      const rows = await tx
        .update(recipes)
        .set({
          name: input.name.trim(),
          aliases: input.aliases ?? existing.aliases,
          servings: input.servings ?? existing.servings,
          notes: input.notes ?? existing.notes,
          updatedAt: new Date(),
        })
        .where(and(eq(recipes.userId, ctx.userId), eq(recipes.id, existing.id)))
        .returning();
      const r = rows[0];
      if (!r) throw new Error("recipes update returned no row");
      recipe = r;
      await tx
        .delete(recipeItems)
        .where(and(eq(recipeItems.userId, ctx.userId), eq(recipeItems.recipeId, existing.id)));
    } else {
      const rows = await tx
        .insert(recipes)
        .values({
          userId: ctx.userId,
          name: input.name.trim(),
          aliases: input.aliases ?? [],
          servings: input.servings ?? 1,
          notes: input.notes,
        })
        .returning();
      const r = rows[0];
      if (!r) throw new Error("recipes insert returned no row");
      recipe = r;
    }

    for (const [i, item] of input.items.entries()) {
      await tx.insert(recipeItems).values({
        userId: ctx.userId,
        recipeId: recipe.id,
        seq: i,
        foodId: item.foodId,
        grams: item.grams,
      });
    }
    return { status: existing ? ("updated" as const) : ("created" as const), recipe };
  });
}

/**
 * Fuzzy-find a recipe (exact name → exact alias → substring) and expand it to
 * log-ready items scaled to `servingsEaten`, with server-computed macros —
 * the agent hands these straight to log_meal.
 */
export async function expandRecipe(
  db: Db,
  ctx: UserCtx,
  name: string,
  servingsEaten = 1,
): Promise<RecipeDetail | undefined> {
  const recipe = await findRecipe(db, ctx, name);
  if (!recipe) return undefined;

  const items = await db
    .select()
    .from(recipeItems)
    .where(and(eq(recipeItems.userId, ctx.userId), eq(recipeItems.recipeId, recipe.id)))
    .orderBy(recipeItems.seq);
  const foodsById = await getFoodsByIds(
    db,
    ctx,
    items.map((i) => i.foodId),
  );

  const scale = servingsEaten / recipe.servings;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const expanded = items.map((i) => {
    const food = foodsById.get(i.foodId);
    if (!food) throw new Error(`recipe item references missing food ${i.foodId}`);
    const grams = r1(i.grams * scale);
    return { foodId: i.foodId, name: food.canonicalName, grams, macros: macrosForGrams(food, grams) };
  });
  const totals: FoodMacros = {
    calories: r1(expanded.reduce((a, i) => a + i.macros.calories, 0)),
    proteinG: r1(expanded.reduce((a, i) => a + i.macros.proteinG, 0)),
    carbsG: r1(expanded.reduce((a, i) => a + i.macros.carbsG, 0)),
    fatG: r1(expanded.reduce((a, i) => a + i.macros.fatG, 0)),
  };
  return { recipe, items: expanded, totals, servingsRequested: servingsEaten };
}

async function findRecipe(db: Db, ctx: UserCtx, name: string): Promise<Recipe | undefined> {
  const q = name.trim().toLowerCase();
  const exact = await db
    .select()
    .from(recipes)
    .where(
      and(
        eq(recipes.userId, ctx.userId),
        or(
          sql`lower(${recipes.name}) = ${q}`,
          sql`exists (select 1 from unnest(${recipes.aliases}) a where lower(a) = ${q})`,
        ),
      ),
    );
  if (exact[0]) return exact[0];
  const fuzzy = await db
    .select()
    .from(recipes)
    .where(
      and(
        eq(recipes.userId, ctx.userId),
        or(
          ilike(recipes.name, `%${q}%`),
          sql`exists (select 1 from unnest(${recipes.aliases}) a where a ilike ${`%${q}%`})`,
        ),
      ),
    );
  return fuzzy[0];
}
