import { beforeEach, describe, expect, it } from "vitest";
import type { Db, UserCtx } from "../src/db/client.js";
import {
  getDayNutrition,
  getTargetsFor,
  logMeal,
  setNutritionTargets,
} from "../src/repos/meals.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ctx = await createTestUser(db);
});

describe("logMeal", () => {
  it("computes totals from items (itemized granularity)", async () => {
    const result = await logMeal(db, ctx, {
      date: "2026-07-01",
      mealType: "lunch",
      description: "Chicken burrito bowl",
      items: [
        { name: "chicken breast", unitNote: "6 oz", calories: 280, proteinG: 52, carbsG: 0, fatG: 6 },
        { name: "rice", unitNote: "1 cup", calories: 210, proteinG: 4, carbsG: 45, fatG: 0.5 },
        { name: "black beans", unitNote: "1/2 cup", calories: 110, proteinG: 7, carbsG: 20, fatG: 0.5, micros: { fiber_g: 7 } },
      ],
    });
    expect(result.status).toBe("logged");
    if (result.status !== "logged") return;
    expect(result.meal.granularity).toBe("itemized");
    expect(result.meal.calories).toBe(600);
    expect(result.meal.proteinG).toBe(63);
  });

  it("accepts direct totals (totals granularity)", async () => {
    const result = await logMeal(db, ctx, {
      date: "2026-07-01",
      mealType: "dinner",
      description: "MacroFactor logged dinner",
      totals: { calories: 850, proteinG: 55, carbsG: 80, fatG: 30 },
    });
    expect(result.status).toBe("logged");
    if (result.status !== "logged") return;
    expect(result.meal.granularity).toBe("totals");
    expect(result.meal.calories).toBe(850);
  });

  it("flags a same-day same-type near-duplicate (§5.9 tier 3)", async () => {
    await logMeal(db, ctx, {
      date: "2026-07-01",
      mealType: "lunch",
      description: "Burrito bowl",
      totals: { calories: 600, proteinG: 60, carbsG: 60, fatG: 12 },
    });
    const dup = await logMeal(db, ctx, {
      date: "2026-07-01",
      mealType: "lunch",
      description: "Chicken bowl",
      totals: { calories: 620, proteinG: 58, carbsG: 62, fatG: 13 },
    });
    expect(dup.status).toBe("possible_duplicate");

    const forced = await logMeal(db, ctx, {
      date: "2026-07-01",
      mealType: "lunch",
      description: "Second lunch, intentional",
      totals: { calories: 620, proteinG: 58, carbsG: 62, fatG: 13 },
      allowDuplicate: true,
    });
    expect(forced.status).toBe("logged");
  });

  it("does not flag clearly different same-day meals", async () => {
    await logMeal(db, ctx, {
      date: "2026-07-01",
      mealType: "snack",
      description: "Protein shake",
      totals: { calories: 200, proteinG: 40, carbsG: 6, fatG: 2 },
    });
    const second = await logMeal(db, ctx, {
      date: "2026-07-01",
      mealType: "snack",
      description: "Apple with peanut butter",
      totals: { calories: 290, proteinG: 8, carbsG: 30, fatG: 16 },
    });
    expect(second.status).toBe("logged");
  });
});

describe("nutrition targets", () => {
  it("effective-dates targets and upserts per date", async () => {
    await setNutritionTargets(db, ctx, {
      effectiveDate: "2026-06-01",
      calories: 2400,
      proteinG: 180,
      carbsG: 250,
      fatG: 80,
    });
    await setNutritionTargets(db, ctx, {
      effectiveDate: "2026-07-01",
      calories: 2300,
      proteinG: 185,
      carbsG: 230,
      fatG: 75,
    });

    expect((await getTargetsFor(db, ctx, "2026-06-15"))?.calories).toBe(2400);
    expect((await getTargetsFor(db, ctx, "2026-07-02"))?.calories).toBe(2300);
    expect(await getTargetsFor(db, ctx, "2026-05-01")).toBeUndefined();

    // Same effective date upserts rather than duplicating
    await setNutritionTargets(db, ctx, {
      effectiveDate: "2026-07-01",
      calories: 2350,
      proteinG: 185,
      carbsG: 235,
      fatG: 76,
    });
    expect((await getTargetsFor(db, ctx, "2026-07-02"))?.calories).toBe(2350);
  });

  it("aggregates the day's meals against targets", async () => {
    await setNutritionTargets(db, ctx, {
      effectiveDate: "2026-07-01",
      calories: 2300,
      proteinG: 185,
      carbsG: 230,
      fatG: 75,
    });
    await logMeal(db, ctx, {
      date: "2026-07-01",
      mealType: "breakfast",
      description: "Eggs and oatmeal",
      totals: { calories: 550, proteinG: 35, carbsG: 55, fatG: 20 },
    });
    await logMeal(db, ctx, {
      date: "2026-07-01",
      mealType: "lunch",
      description: "Bowl",
      totals: { calories: 700, proteinG: 55, carbsG: 70, fatG: 20 },
    });

    const day = await getDayNutrition(db, ctx, "2026-07-01");
    expect(day.totals.calories).toBe(1250);
    expect(day.totals.proteinG).toBe(90);
    expect(day.targets?.calories).toBe(2300);
  });
});
