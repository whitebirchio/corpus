import { beforeEach, describe, expect, it } from "vitest";
import type { Db, UserCtx } from "../src/db/client.js";
import {
  getBodyMeasurementAsOf,
  getDailyMetrics,
  upsertDailyCheckin,
} from "../src/repos/checkins.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ctx = await createTestUser(db);
});

describe("upsertDailyCheckin", () => {
  it("creates a daily_metrics row keyed on local_date", async () => {
    const { metrics } = await upsertDailyCheckin(db, ctx, {
      date: "2026-07-01",
      sleepDuration: { value: 7.17, unit: "h" },
      hrvMs: 58,
      restingHr: 47,
      energy: 4,
    });
    expect(metrics.localDate).toBe("2026-07-01");
    expect(metrics.sleepDurationS).toBe(Math.round(7.17 * 3600));
    expect(metrics.hrvMs).toBe(58);
  });

  it("merges on re-log: updates provided fields, preserves the rest (§5.9)", async () => {
    await upsertDailyCheckin(db, ctx, {
      date: "2026-07-01",
      sleepDuration: { value: 7, unit: "h" },
      sleepQuality: 4,
      energy: 4,
    });
    // Later that day: only steps reported (e.g. evening addendum / Garmin merge)
    await upsertDailyCheckin(db, ctx, { date: "2026-07-01", steps: 11234, restingHr: 48 });

    const merged = await getDailyMetrics(db, ctx, "2026-07-01");
    expect(merged?.steps).toBe(11234);
    expect(merged?.restingHr).toBe(48);
    expect(merged?.sleepDurationS).toBe(7 * 3600); // preserved
    expect(merged?.sleepQualitySubjective).toBe(4); // preserved
    expect(merged?.energySubjective).toBe(4); // preserved
  });

  it("does not duplicate rows for the same day", async () => {
    const a = await upsertDailyCheckin(db, ctx, { date: "2026-07-01", energy: 3 });
    const b = await upsertDailyCheckin(db, ctx, { date: "2026-07-01", energy: 5 });
    expect(b.metrics.id).toBe(a.metrics.id);
    expect(b.metrics.energySubjective).toBe(5);
  });

  it("writes a weigh-in to body_measurements, converting lb to kg", async () => {
    const { weighIn } = await upsertDailyCheckin(db, ctx, {
      date: "2026-07-01",
      weight: { value: 178.2, unit: "lb" },
    });
    expect(weighIn?.weightKg).toBeCloseTo(80.83, 1);
    expect(weighIn?.source).toBe("checkin");

    // Re-logging the same day's weight updates, not duplicates
    const again = await upsertDailyCheckin(db, ctx, {
      date: "2026-07-01",
      weight: { value: 178.6, unit: "lb" },
    });
    expect(again.weighIn?.id).toBe(weighIn?.id);
    expect(again.weighIn?.weightKg).toBeCloseTo(81.01, 1);
  });
});

describe("getBodyMeasurementAsOf", () => {
  it("returns the most recent weigh-in on or before the query date", async () => {
    await upsertDailyCheckin(db, ctx, { date: "2026-06-28", weight: { value: 80, unit: "kg" } });
    await upsertDailyCheckin(db, ctx, {
      date: "2026-06-30",
      weight: { value: 79, unit: "kg" },
      bodyFatPct: 17.5,
    });

    // Exact day: returns that day's reading.
    const onDay = await getBodyMeasurementAsOf(db, ctx, "2026-06-30");
    expect(onDay?.measuredOn).toBe("2026-06-30");
    expect(onDay?.weightKg).toBeCloseTo(79, 5);
    expect(onDay?.bodyFatPct).toBe(17.5);

    // A day with no weigh-in carries the last reading forward.
    const carried = await getBodyMeasurementAsOf(db, ctx, "2026-06-29");
    expect(carried?.measuredOn).toBe("2026-06-28");
    expect(carried?.weightKg).toBeCloseTo(80, 5);
  });

  it("returns null when no weigh-in precedes the date", async () => {
    await upsertDailyCheckin(db, ctx, { date: "2026-06-30", weight: { value: 80, unit: "kg" } });
    expect(await getBodyMeasurementAsOf(db, ctx, "2026-06-29")).toBeNull();
  });

  it("ignores other users' measurements", async () => {
    const other = await createTestUser(db, { email: "other@example.com" });
    await upsertDailyCheckin(db, other, { date: "2026-06-30", weight: { value: 99, unit: "kg" } });
    expect(await getBodyMeasurementAsOf(db, ctx, "2026-06-30")).toBeNull();
  });
});
