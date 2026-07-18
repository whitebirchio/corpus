/**
 * USDA FoodData Central normalization (specs/05-nutrition-accuracy/SPEC.md
 * decision #4). Pure: takes one food object from the `/v1/foods/search`
 * response and produces a FoodCandidate, or null when the entry is unusable.
 * Search-result nutrient values are per 100 g across data types (Branded
 * label values are already rescaled by FDC).
 */
import type { FoodPortion } from "../db/schema.js";
import type { FoodCandidate, Per100g } from "./types.js";

// FDC nutrient numbers → our micro keys (canonical units per key suffix).
const MACRO_IDS = {
  calories: [1008, 2047], // Energy (kcal); Atwater General as fallback
  proteinG: [1003],
  carbsG: [1005],
  fatG: [1004],
} as const;

const MICRO_IDS: Array<{ id: number; key: string }> = [
  { id: 1079, key: "fiber_g" },
  { id: 2000, key: "sugar_g" },
  { id: 1258, key: "sat_fat_g" },
  { id: 1093, key: "sodium_mg" },
  { id: 1253, key: "cholesterol_mg" },
  { id: 1092, key: "potassium_mg" },
];

interface FdcSearchNutrient {
  nutrientId?: number;
  unitName?: string;
  value?: number;
}

interface FdcSearchFood {
  fdcId?: number;
  description?: string;
  dataType?: string;
  brandName?: string;
  brandOwner?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: FdcSearchNutrient[];
}

export function normalizeFdcFood(raw: unknown): FoodCandidate | null {
  const f = raw as FdcSearchFood;
  if (!f || typeof f !== "object" || !f.description || !f.fdcId) return null;

  const byId = new Map<number, FdcSearchNutrient>();
  for (const n of f.foodNutrients ?? []) {
    if (n.nutrientId !== undefined && n.value !== undefined && !byId.has(n.nutrientId)) {
      byId.set(n.nutrientId, n);
    }
  }
  const first = (ids: readonly number[]): number | undefined => {
    for (const id of ids) {
      const v = byId.get(id)?.value;
      if (v !== undefined) return v;
    }
    return undefined;
  };

  const calories = first(MACRO_IDS.calories);
  if (calories === undefined) return null;

  const micros: Record<string, number> = {};
  for (const { id, key } of MICRO_IDS) {
    const v = byId.get(id)?.value;
    if (v !== undefined) micros[key] = v;
  }

  const per100g: Per100g = {
    calories,
    proteinG: first(MACRO_IDS.proteinG) ?? 0,
    carbsG: first(MACRO_IDS.carbsG) ?? 0,
    fatG: first(MACRO_IDS.fatG) ?? 0,
    micros: Object.keys(micros).length > 0 ? micros : undefined,
  };

  // Branded entries carry the label serving; only a mass-based serving maps
  // honestly onto the per-100g basis (no density guessing for "ml").
  const portions: FoodPortion[] = [];
  if (
    f.servingSize !== undefined &&
    f.servingSize > 0 &&
    (f.servingSizeUnit ?? "").trim().toLowerCase() === "g"
  ) {
    portions.push({
      label: f.householdServingFullText?.trim() || "1 serving",
      grams: f.servingSize,
    });
  }

  return {
    name: f.description,
    brand: f.brandName || f.brandOwner || undefined,
    barcode: f.gtinUpc || undefined,
    source: "fdc",
    sourceRef: String(f.fdcId),
    per100g,
    portions,
  };
}
