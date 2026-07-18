/**
 * Personal food catalog (specs/05-nutrition-accuracy/SPEC.md §4).
 *
 * The catalog is per-user and demand-driven: entries exist because Scott eats
 * the food, not because a global DB has it. Matching is agent-mediated —
 * `searchFoodsCatalog` returns ranked candidates for the agent to confirm,
 * never a silent best guess (SPEC 05 decision #5). All portion→gram→macro
 * arithmetic lives here, server-side (decision #1).
 */
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db, UserCtx } from "../db/client.js";
import { foods, type FoodPortion } from "../db/schema.js";
import type { UpsertFoodInput } from "../schemas/foods.js";

export type Food = typeof foods.$inferSelect;

export interface FoodMacros {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  micros?: Record<string, number>;
}

export type UpsertFoodResult = { status: "created" | "updated"; food: Food };

/**
 * Create-or-update by natural key: barcode first, then canonical name, then
 * any alias (all case-insensitive). Aliases merge additively — an update never
 * loses a spelling this food was once logged under; a rename demotes the old
 * canonical name to an alias.
 */
export async function upsertFood(
  db: Db,
  ctx: UserCtx,
  input: UpsertFoodInput,
): Promise<UpsertFoodResult> {
  const lname = input.canonicalName.trim().toLowerCase();
  const existing = await findExisting(db, ctx, lname, input.barcode);

  const macroCols = {
    caloriesPer100g: input.per100g.calories,
    proteinPer100g: input.per100g.proteinG,
    carbsPer100g: input.per100g.carbsG,
    fatPer100g: input.per100g.fatG,
  };

  if (!existing) {
    const rows = await db
      .insert(foods)
      .values({
        userId: ctx.userId,
        canonicalName: input.canonicalName.trim(),
        brand: input.brand,
        aliases: dedupeAliases(input.aliases ?? [], lname),
        barcode: input.barcode,
        ...macroCols,
        micros: input.per100g.micros,
        portions: input.portions ?? [],
        source: input.source,
        sourceRef: input.sourceRef,
        verified: input.verified ?? false,
        notes: input.notes,
      })
      .returning();
    const f = rows[0];
    if (!f) throw new Error("foods insert returned no row");
    return { status: "created", food: f };
  }

  const mergedAliases = dedupeAliases(
    [...existing.aliases, ...(input.aliases ?? []), existing.canonicalName],
    lname,
  );
  const rows = await db
    .update(foods)
    .set({
      canonicalName: input.canonicalName.trim(),
      brand: input.brand ?? existing.brand,
      aliases: mergedAliases,
      barcode: input.barcode ?? existing.barcode,
      ...macroCols,
      micros: input.per100g.micros ?? existing.micros,
      portions: input.portions ?? existing.portions,
      source: input.source,
      sourceRef: input.sourceRef ?? existing.sourceRef,
      verified: input.verified ?? existing.verified,
      notes: input.notes ?? existing.notes,
      updatedAt: new Date(),
    })
    .where(and(eq(foods.userId, ctx.userId), eq(foods.id, existing.id)))
    .returning();
  const f = rows[0];
  if (!f) throw new Error("foods update returned no row");
  return { status: "updated", food: f };
}

async function findExisting(
  db: Db,
  ctx: UserCtx,
  lname: string,
  barcode: string | undefined,
): Promise<Food | undefined> {
  if (barcode) {
    const byBarcode = await db
      .select()
      .from(foods)
      .where(and(eq(foods.userId, ctx.userId), eq(foods.barcode, barcode)));
    if (byBarcode[0]) return byBarcode[0];
  }
  const byName = await db
    .select()
    .from(foods)
    .where(
      and(
        eq(foods.userId, ctx.userId),
        or(
          sql`lower(${foods.canonicalName}) = ${lname}`,
          sql`exists (select 1 from unnest(${foods.aliases}) a where lower(a) = ${lname})`,
        ),
      ),
    );
  return byName[0];
}

/** Case-insensitive dedupe; drops any alias equal to the canonical name. */
function dedupeAliases(aliases: string[], canonicalLower: string): string[] {
  const seen = new Set<string>([canonicalLower]);
  const out: string[] = [];
  for (const a of aliases) {
    const t = a.trim();
    const key = t.toLowerCase();
    if (t && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/**
 * Ranked candidate search over canonical names, aliases, and brand:
 * exact match, then prefix, then substring; verified entries win ties.
 * The catalog is small (tens of rows), so ranking happens in TS.
 */
export async function searchFoodsCatalog(
  db: Db,
  ctx: UserCtx,
  query: string,
  limit = 8,
): Promise<Food[]> {
  const q = query.trim().toLowerCase();
  const pattern = `%${q}%`;
  const rows = await db
    .select()
    .from(foods)
    .where(
      and(
        eq(foods.userId, ctx.userId),
        or(
          ilike(foods.canonicalName, pattern),
          ilike(foods.brand, pattern),
          sql`exists (select 1 from unnest(${foods.aliases}) a where a ilike ${pattern})`,
        ),
      ),
    );

  const rank = (f: Food): number => {
    const names = [f.canonicalName, ...f.aliases].map((n) => n.toLowerCase());
    if (names.some((n) => n === q)) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    return 2;
  };
  return rows
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        Number(b.verified) - Number(a.verified) ||
        a.canonicalName.localeCompare(b.canonicalName),
    )
    .slice(0, limit);
}

export async function getFoodByBarcode(
  db: Db,
  ctx: UserCtx,
  gtin: string,
): Promise<Food | undefined> {
  const rows = await db
    .select()
    .from(foods)
    .where(and(eq(foods.userId, ctx.userId), eq(foods.barcode, gtin)));
  return rows[0];
}

export async function getFoodsByIds(
  db: Db,
  ctx: UserCtx,
  ids: string[],
): Promise<Map<string, Food>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(foods)
    .where(and(eq(foods.userId, ctx.userId), inArray(foods.id, ids)));
  return new Map(rows.map((f) => [f.id, f]));
}

/**
 * Grams for an eaten amount: explicit grams wins; otherwise match
 * `portionLabel` against the food's portion map (forgivingly — "scoop",
 * "1 scoop", and "scoops" all hit the same portion) and scale by `quantity`.
 * Returns undefined when nothing resolves — the caller falls back to
 * agent-supplied macros rather than blocking the log (SPEC 05 decision #6).
 */
export function resolveGrams(
  food: Pick<Food, "portions">,
  opts: { grams?: number; portionLabel?: string; quantity?: number },
): number | undefined {
  if (opts.grams !== undefined) return opts.grams;
  if (!opts.portionLabel) return undefined;
  const want = normalizePortionLabel(opts.portionLabel);
  const hit = (food.portions as FoodPortion[]).find(
    (p) => normalizePortionLabel(p.label) === want,
  );
  if (!hit) return undefined;
  return hit.grams * (opts.quantity ?? 1);
}

/** "1 scoop" / "scoops" / "Scoop" → "scoop": strip leading count + plural s. */
function normalizePortionLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/^[\d\s/.¼½¾]+/, "")
    .trim()
    .replace(/s$/, "");
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Scale a food's per-100g macros (and micros) to `grams` eaten. */
export function macrosForGrams(
  food: Pick<
    Food,
    "caloriesPer100g" | "proteinPer100g" | "carbsPer100g" | "fatPer100g" | "micros"
  >,
  grams: number,
): FoodMacros {
  const k = grams / 100;
  const micros = food.micros
    ? Object.fromEntries(Object.entries(food.micros).map(([key, v]) => [key, r1(v * k)]))
    : undefined;
  return {
    calories: r1(food.caloriesPer100g * k),
    proteinG: r1(food.proteinPer100g * k),
    carbsG: r1(food.carbsPer100g * k),
    fatG: r1(food.fatPer100g * k),
    micros,
  };
}
