import { beforeEach, describe, expect, it } from "vitest";
import type { Db, UserCtx } from "../src/db/client.js";
import { dailyMetrics, meals, workoutBlocks, workoutSessions } from "../src/db/schema.js";
import { getMealWithItems, logMeal } from "../src/repos/meals.js";
import { getTrend, type TrendResult } from "../src/repos/trends.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ctx = await createTestUser(db);
});

async function insertMeal(c: UserCtx, localDate: string, calories: number): Promise<void> {
  await db.insert(meals).values({
    userId: c.userId,
    eatenAt: new Date(`${localDate}T12:00:00Z`),
    localDate,
    mealType: "lunch",
    description: `meal ${localDate}`,
    granularity: "totals",
    calories,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
  });
}

async function insertDay(
  c: UserCtx,
  localDate: string,
  fields: Partial<typeof dailyMetrics.$inferInsert>,
): Promise<void> {
  await db.insert(dailyMetrics).values({ userId: c.userId, localDate, ...fields });
}

async function insertRun(
  c: UserCtx,
  localDate: string,
  distanceM: number,
  blockType: "run" | "strength" = "run",
): Promise<void> {
  const [session] = await db
    .insert(workoutSessions)
    .values({
      userId: c.userId,
      startedAt: new Date(`${localDate}T10:00:00Z`),
      localDate,
      source: "conversation",
    })
    .returning();
  await db.insert(workoutBlocks).values({
    userId: c.userId,
    sessionId: session!.id,
    seq: 0,
    blockType,
    distanceM,
  });
}

function series(result: TrendResult, key: string) {
  const s = result.series.find((x) => x.key === key);
  if (!s) throw new Error(`missing series ${key}`);
  return s;
}

describe("getTrend calories_in", () => {
  it("sums per day with dense null gaps", async () => {
    await insertMeal(ctx, "2026-06-01", 500);
    await insertMeal(ctx, "2026-06-01", 700);
    await insertMeal(ctx, "2026-06-03", 900);

    const result = await getTrend(db, ctx, {
      metric: "calories_in",
      from: "2026-06-01",
      to: "2026-06-04",
      bucket: "day",
    });
    const s = series(result, "calories");
    expect(s.agg).toBe("sum");
    expect(s.points).toEqual([
      { bucket: "2026-06-01", value: 1200, daysWithData: 1 },
      { bucket: "2026-06-02", value: null, daysWithData: 0 },
      { bucket: "2026-06-03", value: 900, daysWithData: 1 },
      { bucket: "2026-06-04", value: null, daysWithData: 0 },
    ]);
  });

  it("buckets by ISO week (Monday start), labeling partial edge buckets", async () => {
    // 2026-06-28 is a Sunday (week of Mon 2026-06-22); 2026-06-29 is a Monday.
    await insertMeal(ctx, "2026-06-28", 1000);
    await insertMeal(ctx, "2026-06-29", 2000);
    await insertMeal(ctx, "2026-06-30", 500);

    const result = await getTrend(db, ctx, {
      metric: "calories_in",
      from: "2026-06-25",
      to: "2026-07-05",
      bucket: "week",
    });
    const s = series(result, "calories");
    expect(s.points).toEqual([
      { bucket: "2026-06-22", value: 1000, daysWithData: 1 },
      { bucket: "2026-06-29", value: 2500, daysWithData: 2 },
    ]);
  });

  it("buckets by calendar month", async () => {
    await insertMeal(ctx, "2026-05-31", 800);
    await insertMeal(ctx, "2026-06-01", 600);
    await insertMeal(ctx, "2026-06-15", 400);

    const result = await getTrend(db, ctx, {
      metric: "calories_in",
      from: "2026-05-01",
      to: "2026-07-31",
      bucket: "month",
    });
    const s = series(result, "calories");
    expect(s.points).toEqual([
      { bucket: "2026-05-01", value: 800, daysWithData: 1 },
      { bucket: "2026-06-01", value: 1000, daysWithData: 2 },
      { bucket: "2026-07-01", value: null, daysWithData: 0 },
    ]);
  });

  it("excludes out-of-range days and other users", async () => {
    await insertMeal(ctx, "2026-05-31", 999);
    await insertMeal(ctx, "2026-06-01", 500);
    const other = await createTestUser(db, { email: "other@example.com" });
    await insertMeal(other, "2026-06-01", 12345);

    const result = await getTrend(db, ctx, {
      metric: "calories_in",
      from: "2026-06-01",
      to: "2026-06-01",
      bucket: "day",
    });
    expect(series(result, "calories").points).toEqual([
      { bucket: "2026-06-01", value: 500, daysWithData: 1 },
    ]);
  });
});

describe("getTrend daily_metrics metrics", () => {
  it("averages resting HR over days with data in the bucket", async () => {
    await insertDay(ctx, "2026-06-01", { restingHr: 50 });
    await insertDay(ctx, "2026-06-02", { restingHr: 54 });
    await insertDay(ctx, "2026-06-03", { steps: 9000 }); // no RHR that day

    const result = await getTrend(db, ctx, {
      metric: "resting_hr",
      from: "2026-06-01",
      to: "2026-06-07",
      bucket: "week",
    });
    expect(series(result, "resting_hr").points).toEqual([
      { bucket: "2026-06-01", value: 52, daysWithData: 2 },
    ]);
  });

  it("tracks body battery high/low as separate avg series with per-column day counts", async () => {
    await insertDay(ctx, "2026-06-01", { bodyBattery: 90, bodyBatteryLow: 20 });
    await insertDay(ctx, "2026-06-02", { bodyBattery: 70 }); // low missing

    const result = await getTrend(db, ctx, {
      metric: "body_battery",
      from: "2026-06-01",
      to: "2026-06-07",
      bucket: "week",
    });
    expect(series(result, "high").agg).toBe("avg");
    expect(series(result, "high").points).toEqual([
      { bucket: "2026-06-01", value: 80, daysWithData: 2 },
    ]);
    expect(series(result, "low").points).toEqual([
      { bucket: "2026-06-01", value: 20, daysWithData: 1 },
    ]);
  });

  it("sums calories out with active and bmr kept separate", async () => {
    await insertDay(ctx, "2026-06-01", { activeKcal: 600, bmrKcal: 1800 });
    await insertDay(ctx, "2026-06-02", { activeKcal: 400 }); // bmr missing

    const result = await getTrend(db, ctx, {
      metric: "calories_out",
      from: "2026-06-01",
      to: "2026-06-07",
      bucket: "week",
    });
    expect(series(result, "active").points).toEqual([
      { bucket: "2026-06-01", value: 1000, daysWithData: 2 },
    ]);
    expect(series(result, "bmr").points).toEqual([
      { bucket: "2026-06-01", value: 1800, daysWithData: 1 },
    ]);
  });
});

describe("getTrend distance_run", () => {
  it("sums run-block distance only, counting distinct run days", async () => {
    await insertRun(ctx, "2026-06-01", 5000);
    await insertRun(ctx, "2026-06-01", 3000);
    await insertRun(ctx, "2026-06-02", 8046.7);
    await insertRun(ctx, "2026-06-03", 99999, "strength"); // not a run block

    const result = await getTrend(db, ctx, {
      metric: "distance_run",
      from: "2026-06-01",
      to: "2026-06-07",
      bucket: "week",
    });
    expect(series(result, "distance").unit).toBe("m");
    expect(series(result, "distance").points).toEqual([
      { bucket: "2026-06-01", value: 16046.7, daysWithData: 2 },
    ]);
  });
});

describe("getTrend validation", () => {
  it("rejects inverted and malformed ranges", async () => {
    await expect(
      getTrend(db, ctx, { metric: "calories_in", from: "2026-06-02", to: "2026-06-01", bucket: "day" }),
    ).rejects.toThrow(/after/);
    await expect(
      getTrend(db, ctx, { metric: "calories_in", from: "June 1", to: "2026-06-01", bucket: "day" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("caps the range size", async () => {
    await expect(
      getTrend(db, ctx, { metric: "calories_in", from: "2000-01-01", to: "2026-06-01", bucket: "month" }),
    ).rejects.toThrow(/Range too large/);
  });
});

describe("getMealWithItems", () => {
  it("returns the meal with items in seq order", async () => {
    const logged = await logMeal(db, ctx, {
      date: "2026-06-01",
      mealType: "lunch",
      description: "Bowl",
      items: [
        { name: "chicken", calories: 280, proteinG: 52, carbsG: 0, fatG: 6 },
        { name: "rice", calories: 210, proteinG: 4, carbsG: 45, fatG: 0.5 },
      ],
    });
    expect(logged.status).toBe("logged");
    if (logged.status !== "logged") return;

    const detail = await getMealWithItems(db, ctx, logged.meal.id);
    expect(detail?.meal.id).toBe(logged.meal.id);
    expect(detail?.items.map((i) => i.name)).toEqual(["chicken", "rice"]);
  });

  it("does not return another user's meal", async () => {
    const logged = await logMeal(db, ctx, {
      date: "2026-06-01",
      mealType: "lunch",
      description: "Bowl",
      totals: { calories: 500, proteinG: 30, carbsG: 40, fatG: 20 },
    });
    if (logged.status !== "logged") throw new Error("expected logged");

    const other = await createTestUser(db, { email: "other@example.com" });
    expect(await getMealWithItems(db, other, logged.meal.id)).toBeUndefined();
    expect(await getMealWithItems(db, ctx, crypto.randomUUID())).toBeUndefined();
  });
});
