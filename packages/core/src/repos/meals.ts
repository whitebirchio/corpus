import { and, desc, eq, lte } from "drizzle-orm";
import type { Db, UserCtx } from "../db/client.js";
import { mealItems, meals, nutritionTargets } from "../db/schema.js";
import type {
  LogMealInput,
  SetNutritionTargetsInput,
  UpdateMealInput,
} from "../schemas/inputs.js";
import { localTimeOf, NOMINAL_MEAL_TIMES, todayIn, zonedToUtc } from "../time.js";

export type Meal = typeof meals.$inferSelect;
export type MealItem = typeof mealItems.$inferSelect;
export type NutritionTarget = typeof nutritionTargets.$inferSelect;

export interface MealDuplicateCandidate {
  mealId: string;
  description: string;
  mealType: string;
  calories: number;
  eatenAt: Date;
}

export type LogMealResult =
  | { status: "logged"; meal: Meal; itemCount: number }
  | { status: "possible_duplicate"; candidates: MealDuplicateCandidate[] };

/**
 * Hybrid granularity per specs/01-initial-platform/SPEC.md §5.4: totals are always populated — summed
 * from items when itemized, taken directly otherwise. Soft dedup per §5.9
 * tier 3: a same-day meal of the same type within 15% calories is surfaced
 * as a candidate instead of silently inserted.
 */
export async function logMeal(db: Db, ctx: UserCtx, input: LogMealInput): Promise<LogMealResult> {
  const localDate = input.date ?? todayIn(ctx.timezone);
  const time = input.time ?? NOMINAL_MEAL_TIMES[input.mealType] ?? "12:00";
  const eatenAt =
    !input.date && !input.time ? new Date() : zonedToUtc(localDate, time, ctx.timezone);

  const itemized = (input.items?.length ?? 0) > 0;
  const totals = itemized
    ? sumItems(input.items ?? [])
    : {
        calories: input.totals?.calories ?? 0,
        proteinG: input.totals?.proteinG ?? 0,
        carbsG: input.totals?.carbsG ?? 0,
        fatG: input.totals?.fatG ?? 0,
      };

  if (!input.allowDuplicate) {
    const sameDay = await db
      .select()
      .from(meals)
      .where(
        and(
          eq(meals.userId, ctx.userId),
          eq(meals.localDate, localDate),
          eq(meals.mealType, input.mealType),
        ),
      );
    const candidates = sameDay
      .filter(
        (m) =>
          totals.calories > 0 &&
          Math.abs(m.calories - totals.calories) / Math.max(totals.calories, 1) <= 0.15,
      )
      .map((m) => ({
        mealId: m.id,
        description: m.description,
        mealType: m.mealType,
        calories: m.calories,
        eatenAt: m.eatenAt,
      }));
    if (candidates.length > 0) return { status: "possible_duplicate", candidates };
  }

  const meal = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(meals)
      .values({
        userId: ctx.userId,
        eatenAt,
        localDate,
        mealType: input.mealType,
        description: input.description,
        granularity: itemized ? "itemized" : "totals",
        calories: totals.calories,
        proteinG: totals.proteinG,
        carbsG: totals.carbsG,
        fatG: totals.fatG,
        photoDocumentId: input.photoDocumentId,
        source: "conversation",
        notes: input.notes,
      })
      .returning();
    const m = rows[0];
    if (!m) throw new Error("meals insert returned no row");

    for (const [i, item] of (input.items ?? []).entries()) {
      await tx.insert(mealItems).values({
        userId: ctx.userId,
        mealId: m.id,
        seq: i,
        name: item.name,
        quantity: item.quantity,
        unitNote: item.unitNote,
        calories: item.calories,
        proteinG: item.proteinG,
        carbsG: item.carbsG,
        fatG: item.fatG,
        micros: item.micros,
        estimateConfidence: item.confidence,
      });
    }
    return m;
  });

  return { status: "logged", meal, itemCount: input.items?.length ?? 0 };
}

function sumItems(items: NonNullable<LogMealInput["items"]>): {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
} {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    calories: r1(items.reduce((a, i) => a + (i.calories ?? 0), 0)),
    proteinG: r1(items.reduce((a, i) => a + (i.proteinG ?? 0), 0)),
    carbsG: r1(items.reduce((a, i) => a + (i.carbsG ?? 0), 0)),
    fatG: r1(items.reduce((a, i) => a + (i.fatG ?? 0), 0)),
  };
}

export async function setNutritionTargets(
  db: Db,
  ctx: UserCtx,
  input: SetNutritionTargetsInput,
): Promise<NutritionTarget> {
  const effectiveDate = input.effectiveDate ?? todayIn(ctx.timezone);
  const values = {
    calories: input.calories,
    proteinG: input.proteinG,
    carbsG: input.carbsG,
    fatG: input.fatG,
    fiberG: input.fiberG,
    notes: input.notes,
  };
  const rows = await db
    .insert(nutritionTargets)
    .values({ userId: ctx.userId, effectiveDate, ...values })
    .onConflictDoUpdate({
      target: [nutritionTargets.userId, nutritionTargets.effectiveDate],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  const t = rows[0];
  if (!t) throw new Error("nutrition_targets upsert returned no row");
  return t;
}

/** The targets in effect on `localDate` (latest effective_date <= date). */
export async function getTargetsFor(
  db: Db,
  ctx: UserCtx,
  localDate: string,
): Promise<NutritionTarget | undefined> {
  const rows = await db
    .select()
    .from(nutritionTargets)
    .where(
      and(eq(nutritionTargets.userId, ctx.userId), lte(nutritionTargets.effectiveDate, localDate)),
    )
    .orderBy(desc(nutritionTargets.effectiveDate))
    .limit(1);
  return rows[0];
}

export interface MealDetail {
  meal: Meal;
  items: MealItem[];
}

/**
 * One addressable meal with its items — backs the PWA's GET /api/meals/:id
 * (specs/02-pwa-client/SPEC.md §5: reads expose ids/provenance so the later
 * edit/delete phase slots in without restructuring).
 */
export async function getMealWithItems(
  db: Db,
  ctx: UserCtx,
  mealId: string,
): Promise<MealDetail | undefined> {
  const rows = await db
    .select()
    .from(meals)
    .where(and(eq(meals.userId, ctx.userId), eq(meals.id, mealId)));
  const meal = rows[0];
  if (!meal) return undefined;
  const items = await db
    .select()
    .from(mealItems)
    .where(and(eq(mealItems.userId, ctx.userId), eq(mealItems.mealId, mealId)))
    .orderBy(mealItems.seq);
  return { meal, items };
}

export type UpdateMealResult =
  | { status: "updated"; meal: Meal; items: MealItem[] }
  | { status: "not_found" }
  | { status: "not_editable"; source: string };

export type DeleteMealResult =
  | { status: "deleted"; mealId: string }
  | { status: "not_found" }
  | { status: "not_editable"; source: string };

/**
 * Correct a conversationally-logged meal. Only `source = "conversation"` meals
 * are editable — imported records (MacroFactor/Garmin) are refused so a re-import
 * can't overwrite the edit (specs/03-record-edits/SPEC.md, specs/02-pwa-client §2 #11).
 * Fields are patched (absent = untouched). Supplying `items` replaces the item
 * list and recomputes totals; supplying `totals` sets them directly and drops any
 * items (input validation forbids sending both).
 */
export async function updateMeal(
  db: Db,
  ctx: UserCtx,
  input: UpdateMealInput,
): Promise<UpdateMealResult> {
  const existing = await getMealWithItems(db, ctx, input.mealId);
  if (!existing) return { status: "not_found" };
  if (existing.meal.source !== "conversation") {
    return { status: "not_editable", source: existing.meal.source };
  }

  const patch: Partial<typeof meals.$inferInsert> = { updatedAt: new Date() };
  if (input.mealType !== undefined) patch.mealType = input.mealType;
  if (input.description !== undefined) patch.description = input.description;
  if (input.notes !== undefined) patch.notes = input.notes;

  if (input.date !== undefined || input.time !== undefined) {
    const localDate = input.date ?? existing.meal.localDate;
    const time = input.time ?? localTimeOf(existing.meal.eatenAt, ctx.timezone);
    patch.localDate = localDate;
    patch.eatenAt = zonedToUtc(localDate, time, ctx.timezone);
  }

  if (input.items !== undefined) {
    const totals = sumItems(input.items);
    patch.granularity = "itemized";
    patch.calories = totals.calories;
    patch.proteinG = totals.proteinG;
    patch.carbsG = totals.carbsG;
    patch.fatG = totals.fatG;
  } else if (input.totals !== undefined) {
    patch.granularity = "totals";
    patch.calories = input.totals.calories;
    patch.proteinG = input.totals.proteinG;
    patch.carbsG = input.totals.carbsG;
    patch.fatG = input.totals.fatG;
  }

  const updated = await db.transaction(async (tx) => {
    if (input.items !== undefined || input.totals !== undefined) {
      // Both paths make the meal's items non-authoritative for `totals` — rebuild.
      await tx
        .delete(mealItems)
        .where(and(eq(mealItems.userId, ctx.userId), eq(mealItems.mealId, input.mealId)));
      for (const [i, item] of (input.items ?? []).entries()) {
        await tx.insert(mealItems).values({
          userId: ctx.userId,
          mealId: input.mealId,
          seq: i,
          name: item.name,
          quantity: item.quantity,
          unitNote: item.unitNote,
          calories: item.calories,
          proteinG: item.proteinG,
          carbsG: item.carbsG,
          fatG: item.fatG,
          micros: item.micros,
          estimateConfidence: item.confidence,
        });
      }
    }
    const rows = await tx
      .update(meals)
      .set(patch)
      .where(and(eq(meals.userId, ctx.userId), eq(meals.id, input.mealId)))
      .returning();
    const m = rows[0];
    if (!m) throw new Error("meals update returned no row");
    return m;
  });

  const detail = await getMealWithItems(db, ctx, input.mealId);
  return { status: "updated", meal: updated, items: detail?.items ?? [] };
}

/** Delete a conversationally-logged meal; `meal_items` cascade. Imports are refused. */
export async function deleteMeal(
  db: Db,
  ctx: UserCtx,
  mealId: string,
): Promise<DeleteMealResult> {
  const existing = await getMealWithItems(db, ctx, mealId);
  if (!existing) return { status: "not_found" };
  if (existing.meal.source !== "conversation") {
    return { status: "not_editable", source: existing.meal.source };
  }
  await db.delete(meals).where(and(eq(meals.userId, ctx.userId), eq(meals.id, mealId)));
  return { status: "deleted", mealId };
}

export interface DayNutrition {
  meals: Meal[];
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number };
  targets: NutritionTarget | undefined;
}

export async function getDayNutrition(
  db: Db,
  ctx: UserCtx,
  localDate: string,
): Promise<DayNutrition> {
  const dayMeals = await db
    .select()
    .from(meals)
    .where(and(eq(meals.userId, ctx.userId), eq(meals.localDate, localDate)))
    .orderBy(meals.eatenAt);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const totals = {
    calories: r1(dayMeals.reduce((a, m) => a + m.calories, 0)),
    proteinG: r1(dayMeals.reduce((a, m) => a + m.proteinG, 0)),
    carbsG: r1(dayMeals.reduce((a, m) => a + m.carbsG, 0)),
    fatG: r1(dayMeals.reduce((a, m) => a + m.fatG, 0)),
  };
  return { meals: dayMeals, totals, targets: await getTargetsFor(db, ctx, localDate) };
}
