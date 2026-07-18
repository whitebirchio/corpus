/**
 * NutritionSource port (specs/05-nutrition-accuracy/SPEC.md decision #8):
 * core defines the interface and the pure response normalizers; the workers
 * implement it with fetch adapters. Core stays HTTP-free.
 */
import type { FoodPortion } from "../db/schema.js";

export interface Per100g {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Same keys as meal_items.micros: fiber_g, sugar_g, sat_fat_g, sodium_mg, ... */
  micros?: Record<string, number>;
}

/** One external-DB match, normalized to the catalog's canonical per-100g shape. */
export interface FoodCandidate {
  name: string;
  brand?: string;
  barcode?: string;
  source: "fdc" | "off";
  /** fdcId or Open Food Facts code — becomes foods.source_ref on save. */
  sourceRef: string;
  per100g: Per100g;
  portions: FoodPortion[];
}

export interface NutritionSource {
  search(query: string, limit?: number): Promise<FoodCandidate[]>;
  byBarcode(gtin: string): Promise<FoodCandidate | null>;
}
