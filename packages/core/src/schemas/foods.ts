/**
 * Input schemas for the personal food catalog & recipes
 * (specs/05-nutrition-accuracy/SPEC.md §4).
 */
import { z } from "zod";

export const foodPortionInput = z.object({
  label: z.string().min(1).describe("Household portion, e.g. '1 scoop', '1 cup'"),
  grams: z.number().positive(),
});

export const per100gInput = z.object({
  calories: z.number().nonnegative(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
  micros: z
    .record(z.string(), z.number())
    .optional()
    .describe("Per 100 g: fiber_g, sugar_g, sat_fat_g, sodium_mg, cholesterol_mg, ..."),
});

export const upsertFoodShape = {
  canonicalName: z.string().min(1).describe("The one name this food is always logged under"),
  brand: z.string().optional(),
  aliases: z
    .array(z.string().min(1))
    .optional()
    .describe("Other names/spellings it has been logged under; merged additively"),
  barcode: z
    .string()
    .regex(/^\d{8,14}$/)
    .optional()
    .describe("GTIN/UPC digits, when known"),
  per100g: per100gInput.describe("Macros per 100 g (convert label serving → 100 g first)"),
  portions: z
    .array(foodPortionInput)
    .optional()
    .describe("Household portions with gram weights, e.g. [{label:'1 scoop', grams:31}]"),
  source: z
    .enum(["label", "fdc", "off", "estimate"])
    .describe("label = read off packaging; fdc = USDA FoodData Central; off = Open Food Facts"),
  sourceRef: z.string().optional().describe("fdcId or Open Food Facts code, when source is a DB"),
  verified: z.boolean().optional().describe("True once macros were checked against the label"),
  notes: z.string().optional(),
};
export const upsertFoodInput = z.object(upsertFoodShape);
export type UpsertFoodInput = z.infer<typeof upsertFoodInput>;

export const searchFoodsShape = {
  query: z.string().min(1).describe("Name, alias, or brand fragment"),
  limit: z.number().int().min(1).max(20).optional(),
};
export const searchFoodsInput = z.object(searchFoodsShape);
export type SearchFoodsInput = z.infer<typeof searchFoodsInput>;

export const saveRecipeShape = {
  name: z.string().min(1).describe("Recipe name, e.g. 'my protein smoothie'"),
  aliases: z.array(z.string().min(1)).optional(),
  servings: z
    .number()
    .positive()
    .optional()
    .describe("How many servings the full item list makes; default 1"),
  items: z
    .array(
      z.object({
        foodId: z.uuid().describe("Catalog food id from search_foods"),
        grams: z.number().positive().describe("Grams in the WHOLE recipe (all servings)"),
      }),
    )
    .min(1),
  notes: z.string().optional(),
};
export const saveRecipeInput = z.object(saveRecipeShape);
export type SaveRecipeInput = z.infer<typeof saveRecipeInput>;

export const getRecipeShape = {
  name: z.string().min(1).describe("Recipe name or alias; fuzzy-matched"),
  servings: z
    .number()
    .positive()
    .optional()
    .describe("Servings eaten — scales the returned log-ready items; default 1"),
};
export const getRecipeInput = z.object(getRecipeShape);
export type GetRecipeInput = z.infer<typeof getRecipeInput>;
