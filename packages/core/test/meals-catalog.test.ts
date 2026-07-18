import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db, UserCtx } from "../src/db/client.js";
import { mealItems } from "../src/db/schema.js";
import { upsertFood } from "../src/repos/foods.js";
import { getMealWithItems, logMeal, updateMeal } from "../src/repos/meals.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;
let wheyId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ctx = await createTestUser(db);
  wheyId = (
    await upsertFood(db, ctx, {
      canonicalName: "Ascent vanilla whey protein",
      per100g: {
        calories: 387,
        proteinG: 80.6,
        carbsG: 6.5,
        fatG: 3.2,
        micros: { sodium_mg: 210 },
      },
      portions: [{ label: "1 scoop", grams: 31 }],
      source: "label",
      verified: true,
    })
  ).food.id;
});

describe("logMeal with catalog items (SPEC 05 §4.2)", () => {
  it("computes macros server-side from foodId + grams, overriding agent estimates", async () => {
    const result = await logMeal(db, ctx, {
      date: "2026-07-18",
      mealType: "snack",
      description: "Post-workout shake",
      items: [
        {
          name: "Ascent vanilla whey protein",
          unitNote: "2 scoops (62 g)",
          foodId: wheyId,
          grams: 62,
          calories: 500, // wrong on purpose — server must override
          proteinG: 10,
        },
      ],
    });
    expect(result.status).toBe("logged");
    if (result.status !== "logged") return;
    expect(result.meal.calories).toBe(239.9); // 387 × 0.62
    expect(result.meal.proteinG).toBe(50);

    const detail = await getMealWithItems(db, ctx, result.meal.id);
    const item = detail?.items[0];
    expect(item?.foodId).toBe(wheyId);
    expect(item?.gramsResolved).toBe(62);
    expect(item?.micros?.["sodium_mg"]).toBe(130.2);
  });

  it("resolves portionLabel × quantity through the food's portion map", async () => {
    const result = await logMeal(db, ctx, {
      mealType: "snack",
      description: "Shake",
      items: [
        { name: "Whey", unitNote: "2 scoops", foodId: wheyId, portionLabel: "scoop", quantity: 2 },
      ],
    });
    expect(result.status).toBe("logged");
    if (result.status !== "logged") return;
    expect(result.meal.calories).toBe(239.9);
  });

  it("falls back to agent macros when grams can't be resolved (decision #6)", async () => {
    const result = await logMeal(db, ctx, {
      mealType: "snack",
      description: "Shake, unknown portion",
      items: [
        {
          name: "Whey",
          unitNote: "a splash",
          foodId: wheyId,
          portionLabel: "splash", // not in the portion map
          calories: 100,
          proteinG: 20,
          carbsG: 2,
          fatG: 1,
        },
      ],
    });
    expect(result.status).toBe("logged");
    if (result.status !== "logged") return;
    expect(result.meal.calories).toBe(100);
    const rows = await db
      .select()
      .from(mealItems)
      .where(and(eq(mealItems.userId, ctx.userId), eq(mealItems.mealId, result.meal.id)));
    expect(rows[0]?.gramsResolved).toBeNull();
    expect(rows[0]?.foodId).toBe(wheyId); // binding kept even when unresolved
  });

  it("throws on an unknown foodId instead of logging bad data", async () => {
    await expect(
      logMeal(db, ctx, {
        mealType: "snack",
        description: "Shake",
        items: [
          { name: "Whey", foodId: "00000000-0000-0000-0000-000000000000", grams: 31 },
        ],
      }),
    ).rejects.toThrow(/unknown catalog food/);
  });

  it("updateMeal item-replace resolves catalog items the same way", async () => {
    const logged = await logMeal(db, ctx, {
      mealType: "snack",
      description: "Shake",
      totals: { calories: 200, proteinG: 20, carbsG: 10, fatG: 5 },
    });
    expect(logged.status).toBe("logged");
    if (logged.status !== "logged") return;

    const updated = await updateMeal(db, ctx, {
      mealId: logged.meal.id,
      items: [{ name: "Whey", foodId: wheyId, grams: 31 }],
    });
    expect(updated.status).toBe("updated");
    if (updated.status !== "updated") return;
    expect(updated.meal.calories).toBe(120); // 387 × 0.31
    expect(updated.items[0]?.gramsResolved).toBe(31);
  });
});
