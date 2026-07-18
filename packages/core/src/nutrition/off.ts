/**
 * Open Food Facts normalization (specs/05-nutrition-accuracy/SPEC.md
 * decision #4). Pure: takes one `product` object from the OFF API (barcode
 * lookup or search) and produces a FoodCandidate, or null when unusable.
 * OFF publishes nutriments per 100 g under `*_100g` keys; sodium comes back
 * in grams and is converted to mg (canonical micro unit).
 */
import type { FoodPortion } from "../db/schema.js";
import type { FoodCandidate, Per100g } from "./types.js";

interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  nutriments?: Record<string, number | string | undefined>;
}

const num = (v: number | string | undefined): number | undefined => {
  if (v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function normalizeOffProduct(raw: unknown): FoodCandidate | null {
  const p = raw as OffProduct;
  if (!p || typeof p !== "object" || !p.code) return null;
  const name = p.product_name?.trim() || p.product_name_en?.trim();
  if (!name) return null;

  const n = p.nutriments ?? {};
  const calories = num(n["energy-kcal_100g"]);
  if (calories === undefined) return null;

  const micros: Record<string, number> = {};
  const fiber = num(n["fiber_100g"]);
  if (fiber !== undefined) micros["fiber_g"] = fiber;
  const sugar = num(n["sugars_100g"]);
  if (sugar !== undefined) micros["sugar_g"] = sugar;
  const satFat = num(n["saturated-fat_100g"]);
  if (satFat !== undefined) micros["sat_fat_g"] = satFat;
  const sodiumG = num(n["sodium_100g"]);
  if (sodiumG !== undefined) micros["sodium_mg"] = Math.round(sodiumG * 1000);

  const per100g: Per100g = {
    calories,
    proteinG: num(n["proteins_100g"]) ?? 0,
    carbsG: num(n["carbohydrates_100g"]) ?? 0,
    fatG: num(n["fat_100g"]) ?? 0,
    micros: Object.keys(micros).length > 0 ? micros : undefined,
  };

  // A usable serving needs a mass quantity; OFF's unit field is spotty, so
  // accept grams when the unit says "g" or is absent (OFF's default basis).
  const portions: FoodPortion[] = [];
  const servingQty = num(p.serving_quantity);
  const servingUnit = (p.serving_quantity_unit ?? "g").trim().toLowerCase();
  if (servingQty !== undefined && servingQty > 0 && servingUnit === "g") {
    portions.push({ label: p.serving_size?.trim() || "1 serving", grams: servingQty });
  }

  return {
    name,
    brand: p.brands?.split(",")[0]?.trim() || undefined,
    barcode: p.code,
    source: "off",
    sourceRef: p.code,
    per100g,
    portions,
  };
}
