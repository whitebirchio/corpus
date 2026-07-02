import { beforeEach, describe, expect, it } from "vitest";
import type { Db, UserCtx } from "../src/db/client.js";
import { getDailyMetrics, upsertDailyCheckin } from "../src/repos/checkins.js";
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
