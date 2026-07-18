import { beforeEach, describe, expect, it } from "vitest";
import type { Db, UserCtx } from "../src/db/client.js";
import {
  getFoodByBarcode,
  macrosForGrams,
  resolveGrams,
  searchFoodsCatalog,
  upsertFood,
} from "../src/repos/foods.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ctx = await createTestUser(db);
});

const ascentWhey = {
  canonicalName: "Ascent vanilla whey protein",
  brand: "Ascent",
  aliases: ["Ascent Vanilla Bean whey protein", "vanilla whey protein"],
  per100g: { calories: 387, proteinG: 80.6, carbsG: 6.5, fatG: 3.2 },
  portions: [{ label: "1 scoop", grams: 31 }],
  source: "label" as const,
  verified: true,
};

describe("upsertFood", () => {
  it("creates, then updates by case-insensitive name with additive alias merge", async () => {
    const created = await upsertFood(db, ctx, ascentWhey);
    expect(created.status).toBe("created");
    expect(created.food.verified).toBe(true);

    const updated = await upsertFood(db, ctx, {
      ...ascentWhey,
      canonicalName: "ASCENT VANILLA WHEY PROTEIN",
      aliases: ["Ascent Native Fuel Whey Vanilla"],
      per100g: { ...ascentWhey.per100g, calories: 390 },
    });
    expect(updated.status).toBe("updated");
    expect(updated.food.id).toBe(created.food.id);
    expect(updated.food.caloriesPer100g).toBe(390);
    // old aliases kept, new one merged, nothing duplicated
    const lower = updated.food.aliases.map((a) => a.toLowerCase());
    expect(lower).toContain("ascent vanilla bean whey protein");
    expect(lower).toContain("ascent native fuel whey vanilla");
    expect(new Set(lower).size).toBe(lower.length);
  });

  it("matches an existing entry by alias and demotes a replaced canonical name", async () => {
    const created = await upsertFood(db, ctx, ascentWhey);
    const renamed = await upsertFood(db, ctx, {
      ...ascentWhey,
      canonicalName: "vanilla whey protein", // was an alias
    });
    expect(renamed.status).toBe("updated");
    expect(renamed.food.id).toBe(created.food.id);
    // the old canonical name survives as an alias
    expect(renamed.food.aliases.map((a) => a.toLowerCase())).toContain(
      "ascent vanilla whey protein",
    );
  });

  it("matches by barcode ahead of name", async () => {
    const created = await upsertFood(db, ctx, {
      ...ascentWhey,
      barcode: "850003239118",
    });
    const rescanned = await upsertFood(db, ctx, {
      ...ascentWhey,
      canonicalName: "Completely different name",
      barcode: "850003239118",
    });
    expect(rescanned.status).toBe("updated");
    expect(rescanned.food.id).toBe(created.food.id);
    expect(await getFoodByBarcode(db, ctx, "850003239118")).toBeDefined();
    expect(await getFoodByBarcode(db, ctx, "000000000000")).toBeUndefined();
  });
});

describe("searchFoodsCatalog", () => {
  it("ranks exact > prefix > substring across names and aliases", async () => {
    await upsertFood(db, ctx, ascentWhey);
    await upsertFood(db, ctx, {
      canonicalName: "Whey protein crisps",
      per100g: { calories: 400, proteinG: 50, carbsG: 30, fatG: 10 },
      source: "estimate",
    });

    const exact = await searchFoodsCatalog(db, ctx, "vanilla whey protein");
    expect(exact[0]?.canonicalName).toBe("Ascent vanilla whey protein");

    const sub = await searchFoodsCatalog(db, ctx, "whey");
    expect(sub.map((f) => f.canonicalName)).toContain("Whey protein crisps");
    expect(sub.map((f) => f.canonicalName)).toContain("Ascent vanilla whey protein");
  });
});

describe("portion & macro math", () => {
  const food = {
    portions: [
      { label: "1 scoop", grams: 31 },
      { label: "1 cup", grams: 240 },
    ],
  };

  it("explicit grams wins; portion labels match forgivingly and scale by quantity", () => {
    expect(resolveGrams(food, { grams: 62, portionLabel: "1 scoop" })).toBe(62);
    expect(resolveGrams(food, { portionLabel: "scoop", quantity: 2 })).toBe(62);
    expect(resolveGrams(food, { portionLabel: "Scoops", quantity: 2 })).toBe(62);
    expect(resolveGrams(food, { portionLabel: "1 cup" })).toBe(240);
    expect(resolveGrams(food, { portionLabel: "slice" })).toBeUndefined();
    expect(resolveGrams(food, {})).toBeUndefined();
  });

  it("scales per-100g macros and micros to grams eaten", () => {
    const m = macrosForGrams(
      {
        caloriesPer100g: 387,
        proteinPer100g: 80.6,
        carbsPer100g: 6.5,
        fatPer100g: 3.2,
        micros: { sodium_mg: 210 },
      },
      31,
    );
    expect(m.calories).toBe(120);
    expect(m.proteinG).toBe(25);
    expect(m.micros?.["sodium_mg"]).toBe(65.1);
  });
});
