import { describe, expect, it } from "vitest";
import { normalizeFdcFood } from "../src/nutrition/fdc.js";
import { normalizeOffProduct } from "../src/nutrition/off.js";

// Trimmed real-shaped fixtures: one FDC Branded search hit, one FDC survey
// (FNDDS) hit, one OFF product. Values are per 100 g in both APIs.

const fdcBranded = {
  fdcId: 2107537,
  description: "100% WHEY PROTEIN POWDER, VANILLA BEAN",
  dataType: "Branded",
  brandOwner: "Ascent Protein",
  brandName: "ASCENT",
  gtinUpc: "850003239118",
  servingSize: 31.0,
  servingSizeUnit: "g",
  householdServingFullText: "1 scoop",
  foodNutrients: [
    { nutrientId: 1008, nutrientName: "Energy", unitName: "KCAL", value: 387 },
    { nutrientId: 1003, nutrientName: "Protein", unitName: "G", value: 80.6 },
    { nutrientId: 1005, nutrientName: "Carbohydrate, by difference", unitName: "G", value: 6.45 },
    { nutrientId: 1004, nutrientName: "Total lipid (fat)", unitName: "G", value: 3.23 },
    { nutrientId: 1093, nutrientName: "Sodium, Na", unitName: "MG", value: 210 },
    { nutrientId: 2000, nutrientName: "Sugars, total", unitName: "G", value: 3.23 },
  ],
};

const fdcSurvey = {
  fdcId: 2705384,
  description: "Rice, white, cooked, no added fat",
  dataType: "Survey (FNDDS)",
  foodNutrients: [
    { nutrientId: 1008, nutrientName: "Energy", unitName: "KCAL", value: 129 },
    { nutrientId: 1003, nutrientName: "Protein", unitName: "G", value: 2.66 },
    { nutrientId: 1005, nutrientName: "Carbohydrate, by difference", unitName: "G", value: 27.9 },
    { nutrientId: 1004, nutrientName: "Total lipid (fat)", unitName: "G", value: 0.28 },
    { nutrientId: 1079, nutrientName: "Fiber, total dietary", unitName: "G", value: 0.4 },
  ],
};

const offProduct = {
  code: "0850003239118",
  product_name: "100% Whey Protein Powder - Vanilla Bean",
  brands: "Ascent, Ascent Protein",
  serving_size: "1 scoop (31g)",
  serving_quantity: 31,
  serving_quantity_unit: "g",
  nutriments: {
    "energy-kcal_100g": 387,
    proteins_100g: 80.6,
    carbohydrates_100g: 6.45,
    fat_100g: 3.23,
    "saturated-fat_100g": 1.61,
    sugars_100g: 3.23,
    sodium_100g: 0.21,
  },
};

describe("normalizeFdcFood", () => {
  it("normalizes a Branded hit with barcode, brand, and label portion", () => {
    const c = normalizeFdcFood(fdcBranded);
    expect(c).not.toBeNull();
    expect(c?.source).toBe("fdc");
    expect(c?.sourceRef).toBe("2107537");
    expect(c?.barcode).toBe("850003239118");
    expect(c?.brand).toBe("ASCENT");
    expect(c?.per100g.calories).toBe(387);
    expect(c?.per100g.proteinG).toBe(80.6);
    expect(c?.per100g.micros?.["sodium_mg"]).toBe(210);
    expect(c?.portions).toEqual([{ label: "1 scoop", grams: 31 }]);
  });

  it("normalizes an FNDDS hit (no portions in search results)", () => {
    const c = normalizeFdcFood(fdcSurvey);
    expect(c?.per100g.calories).toBe(129);
    expect(c?.per100g.micros?.["fiber_g"]).toBe(0.4);
    expect(c?.portions).toEqual([]);
  });

  it("rejects entries without energy", () => {
    expect(normalizeFdcFood({ fdcId: 1, description: "x", foodNutrients: [] })).toBeNull();
    expect(normalizeFdcFood(null)).toBeNull();
  });
});

describe("normalizeOffProduct", () => {
  it("normalizes a product with sodium g→mg and a gram serving", () => {
    const c = normalizeOffProduct(offProduct);
    expect(c).not.toBeNull();
    expect(c?.source).toBe("off");
    expect(c?.sourceRef).toBe("0850003239118");
    expect(c?.barcode).toBe("0850003239118");
    expect(c?.brand).toBe("Ascent");
    expect(c?.per100g.fatG).toBe(3.23);
    expect(c?.per100g.micros?.["sodium_mg"]).toBe(210);
    expect(c?.per100g.micros?.["sat_fat_g"]).toBe(1.61);
    expect(c?.portions).toEqual([{ label: "1 scoop (31g)", grams: 31 }]);
  });

  it("tolerates OFF's explicit nulls without coercing them to 0", () => {
    const c = normalizeOffProduct({
      code: "3017620422003",
      product_name: "Nutella",
      brands: null,
      serving_size: null,
      serving_quantity: null,
      serving_quantity_unit: "g",
      nutriments: { "energy-kcal_100g": 539, proteins_100g: 6.3, sodium_100g: null },
    });
    expect(c?.per100g.calories).toBe(539);
    expect(c?.brand).toBeUndefined();
    expect(c?.portions).toEqual([]);
    expect(c?.per100g.micros?.["sodium_mg"]).toBeUndefined();
  });

  it("rejects products without a name or kcal", () => {
    expect(normalizeOffProduct({ code: "123", nutriments: {} })).toBeNull();
    expect(
      normalizeOffProduct({ code: "123", product_name: "Thing", nutriments: {} }),
    ).toBeNull();
    expect(normalizeOffProduct(undefined)).toBeNull();
  });
});
