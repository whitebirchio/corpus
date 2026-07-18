import { beforeEach, describe, expect, it } from "vitest";
import type { Db, UserCtx } from "../src/db/client.js";
import { upsertFood } from "../src/repos/foods.js";
import { expandRecipe, saveRecipe } from "../src/repos/recipes.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;
let wheyId: string;
let almondMilkId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ctx = await createTestUser(db);
  wheyId = (
    await upsertFood(db, ctx, {
      canonicalName: "Ascent vanilla whey protein",
      per100g: { calories: 387, proteinG: 80.6, carbsG: 6.5, fatG: 3.2 },
      source: "label",
    })
  ).food.id;
  almondMilkId = (
    await upsertFood(db, ctx, {
      canonicalName: "Unsweetened vanilla almond milk",
      per100g: { calories: 13, proteinG: 0.4, carbsG: 0.6, fatG: 1.1 },
      source: "label",
    })
  ).food.id;
});

describe("saveRecipe / expandRecipe", () => {
  it("saves, then expands to log-ready items with per-serving scaling", async () => {
    const saved = await saveRecipe(db, ctx, {
      name: "My protein smoothie",
      aliases: ["protein shake"],
      servings: 2,
      items: [
        { foodId: wheyId, grams: 62 }, // 2 scoops across 2 servings
        { foodId: almondMilkId, grams: 480 },
      ],
    });
    expect(saved.status).toBe("created");

    const one = await expandRecipe(db, ctx, "protein shake", 1); // via alias
    expect(one).toBeDefined();
    expect(one?.items.map((i) => i.grams)).toEqual([31, 240]);
    // whey: 387×0.31=120 kcal; milk: 13×2.4=31.2 kcal
    expect(one?.totals.calories).toBe(151.2);
    expect(one?.items[0]?.macros.proteinG).toBe(25);
  });

  it("re-saving the same name replaces the item list", async () => {
    await saveRecipe(db, ctx, {
      name: "My protein smoothie",
      items: [{ foodId: wheyId, grams: 31 }],
    });
    const resaved = await saveRecipe(db, ctx, {
      name: "my PROTEIN smoothie",
      items: [{ foodId: almondMilkId, grams: 240 }],
    });
    expect(resaved.status).toBe("updated");
    const expanded = await expandRecipe(db, ctx, "my protein smoothie");
    expect(expanded?.items).toHaveLength(1);
    expect(expanded?.items[0]?.name).toBe("Unsweetened vanilla almond milk");
  });

  it("refuses unknown catalog food ids", async () => {
    await expect(
      saveRecipe(db, ctx, {
        name: "Bad recipe",
        items: [{ foodId: "00000000-0000-0000-0000-000000000000", grams: 100 }],
      }),
    ).rejects.toThrow(/unknown catalog food/);
  });

  it("returns undefined for an unknown recipe name", async () => {
    expect(await expandRecipe(db, ctx, "nonexistent")).toBeUndefined();
  });
});
