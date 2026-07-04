import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db, UserCtx } from "../src/db/client.js";
import { mealItems, meals } from "../src/db/schema.js";
import {
  deleteMeal,
  getDayNutrition,
  getMealWithItems,
  logMeal,
  updateMeal,
} from "../src/repos/meals.js";
import { updateMealInput } from "../src/schemas/inputs.js";
import { localTimeOf } from "../src/time.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ctx = await createTestUser(db);
});

async function logLunch() {
  const r = await logMeal(db, ctx, {
    date: "2026-07-01",
    time: "13:15",
    mealType: "lunch",
    description: "Burrito bowl",
    totals: { calories: 600, proteinG: 60, carbsG: 60, fatG: 12 },
  });
  if (r.status !== "logged") throw new Error("setup log failed");
  return r.meal;
}

describe("updateMeal", () => {
  it("patches scalar fields, leaving the rest untouched", async () => {
    const meal = await logLunch();
    const res = await updateMeal(db, ctx, {
      mealId: meal.id,
      description: "Chicken burrito bowl (corrected)",
      notes: "extra guac",
    });
    expect(res.status).toBe("updated");
    if (res.status !== "updated") return;
    expect(res.meal.description).toBe("Chicken burrito bowl (corrected)");
    expect(res.meal.notes).toBe("extra guac");
    expect(res.meal.mealType).toBe("lunch");
    expect(res.meal.calories).toBe(600);
  });

  it("replaces items and recomputes totals (granularity flips to itemized)", async () => {
    const meal = await logLunch();
    const res = await updateMeal(db, ctx, {
      mealId: meal.id,
      items: [
        { name: "chicken", calories: 280, proteinG: 52, carbsG: 0, fatG: 6 },
        { name: "rice", calories: 210, proteinG: 4, carbsG: 45, fatG: 0.5 },
      ],
    });
    expect(res.status).toBe("updated");
    if (res.status !== "updated") return;
    expect(res.meal.granularity).toBe("itemized");
    expect(res.meal.calories).toBe(490);
    expect(res.meal.proteinG).toBe(56);
    expect(res.items).toHaveLength(2);
  });

  it("setting totals on an itemized meal clears its items", async () => {
    const logged = await logMeal(db, ctx, {
      date: "2026-07-01",
      mealType: "dinner",
      description: "Itemized dinner",
      items: [{ name: "steak", calories: 500, proteinG: 50, carbsG: 0, fatG: 30 }],
    });
    if (logged.status !== "logged") throw new Error("setup failed");

    const res = await updateMeal(db, ctx, {
      mealId: logged.meal.id,
      totals: { calories: 700, proteinG: 55, carbsG: 10, fatG: 40 },
    });
    expect(res.status).toBe("updated");
    if (res.status !== "updated") return;
    expect(res.meal.granularity).toBe("totals");
    expect(res.meal.calories).toBe(700);
    expect(res.items).toHaveLength(0);
    const detail = await getMealWithItems(db, ctx, logged.meal.id);
    expect(detail?.items).toHaveLength(0);
  });

  it("recomputes eatenAt/localDate on a date change, preserving the original time", async () => {
    const meal = await logLunch();
    expect(localTimeOf(meal.eatenAt, ctx.timezone)).toBe("13:15");

    const res = await updateMeal(db, ctx, { mealId: meal.id, date: "2026-07-02" });
    expect(res.status).toBe("updated");
    if (res.status !== "updated") return;
    expect(res.meal.localDate).toBe("2026-07-02");
    expect(localTimeOf(res.meal.eatenAt, ctx.timezone)).toBe("13:15");
  });

  it("returns not_found for an unknown id", async () => {
    const res = await updateMeal(db, ctx, {
      mealId: "00000000-0000-0000-0000-000000000000",
      description: "x",
    });
    expect(res.status).toBe("not_found");
  });

  it("refuses to edit an imported (non-conversation) meal", async () => {
    const rows = await db
      .insert(meals)
      .values({
        userId: ctx.userId,
        eatenAt: new Date("2026-07-01T17:00:00Z"),
        localDate: "2026-07-01",
        mealType: "lunch",
        description: "MacroFactor import",
        granularity: "totals",
        calories: 600,
        proteinG: 60,
        carbsG: 60,
        fatG: 12,
        source: "macrofactor_export",
        sourceRef: "mf-123",
      })
      .returning();
    const imported = rows[0];
    if (!imported) throw new Error("insert failed");

    const res = await updateMeal(db, ctx, { mealId: imported.id, description: "hacked" });
    expect(res.status).toBe("not_editable");
    if (res.status !== "not_editable") return;
    expect(res.source).toBe("macrofactor_export");

    const still = await getMealWithItems(db, ctx, imported.id);
    expect(still?.meal.description).toBe("MacroFactor import");
  });

  it("rejects sending both items and totals (schema guard)", () => {
    expect(() =>
      updateMealInput.parse({
        mealId: "00000000-0000-0000-0000-000000000000",
        items: [{ name: "x", calories: 1 }],
        totals: { calories: 1, proteinG: 1, carbsG: 1, fatG: 1 },
      }),
    ).toThrow();
  });
});

describe("deleteMeal", () => {
  it("deletes the meal and cascades its items; day totals drop", async () => {
    await logMeal(db, ctx, {
      date: "2026-07-01",
      mealType: "breakfast",
      description: "Eggs",
      items: [{ name: "eggs", calories: 200, proteinG: 18, carbsG: 2, fatG: 14 }],
    });
    const lunch = await logMeal(db, ctx, {
      date: "2026-07-01",
      mealType: "lunch",
      description: "Bowl",
      totals: { calories: 600, proteinG: 60, carbsG: 60, fatG: 12 },
    });
    if (lunch.status !== "logged") throw new Error("setup failed");

    const before = await getDayNutrition(db, ctx, "2026-07-01");
    expect(before.totals.calories).toBe(800);

    const res = await deleteMeal(db, ctx, lunch.meal.id);
    expect(res.status).toBe("deleted");

    const after = await getDayNutrition(db, ctx, "2026-07-01");
    expect(after.totals.calories).toBe(200);
    expect(after.meals).toHaveLength(1);

    const remainingItems = await db
      .select()
      .from(mealItems)
      .where(and(eq(mealItems.userId, ctx.userId), eq(mealItems.mealId, lunch.meal.id)));
    expect(remainingItems).toHaveLength(0);
    const gone = await db.select().from(meals).where(eq(meals.id, lunch.meal.id));
    expect(gone).toHaveLength(0);
  });

  it("returns not_found for an unknown id", async () => {
    const res = await deleteMeal(db, ctx, "00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe("not_found");
  });

  it("refuses to delete an imported meal", async () => {
    const rows = await db
      .insert(meals)
      .values({
        userId: ctx.userId,
        eatenAt: new Date("2026-07-01T17:00:00Z"),
        localDate: "2026-07-01",
        mealType: "lunch",
        description: "Garmin-sourced",
        granularity: "totals",
        calories: 500,
        proteinG: 40,
        carbsG: 50,
        fatG: 10,
        source: "garmin_export",
        sourceRef: "g-1",
      })
      .returning();
    const imported = rows[0];
    if (!imported) throw new Error("insert failed");
    const res = await deleteMeal(db, ctx, imported.id);
    expect(res.status).toBe("not_editable");
    const still = await db.select().from(meals).where(eq(meals.id, imported.id));
    expect(still).toHaveLength(1);
  });
});
