import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db, UserCtx } from "../src/db/client.js";
import { workoutBlocks, workoutSessions } from "../src/db/schema.js";
import { garminDayToCheckin, importGarminData } from "../src/import/garmin.js";
import { getDailyMetrics } from "../src/repos/checkins.js";
import { upsertDailyCheckin } from "../src/repos/checkins.js";
import { logWorkout } from "../src/repos/workouts.js";
import { seedMovements } from "../src/seed/movements.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;

beforeEach(async () => {
  ({ db } = await createTestDb());
  await seedMovements(db);
  ctx = await createTestUser(db);
});

// Fixtures shaped like the real Garmin Connect API responses the sync job
// forwards: get_stats → stats, get_sleep_data().dailySleepDTO → sleep,
// get_hrv_data().hrvSummary → hrv, get_activities_by_date → activities.
const wellnessDay = {
  date: "2026-07-01",
  stats: {
    totalSteps: 9432,
    restingHeartRate: 47,
    bodyBatteryHighestValue: 92,
    bodyBatteryLowestValue: 24,
    averageStressLevel: 31,
    activeKilocalories: 731,
    bmrKilocalories: 1680,
    moderateIntensityMinutes: 45,
    vigorousIntensityMinutes: 20,
    avgWakingRespirationValue: 13.4,
  },
  sleep: {
    sleepTimeSeconds: 25740,
    deepSleepSeconds: 5400,
    lightSleepSeconds: 15000,
    remSleepSeconds: 5340,
    awakeSleepSeconds: 600,
    averageSpO2Value: 95,
    averageRespirationValue: 14.1,
    sleepScores: { overall: { value: 82 } },
  },
  hrv: { lastNightAvg: 58 },
  trainingReadiness: { score: 74, level: "READY" },
  maxMetrics: { generic: { vo2MaxValue: 48.0, fitnessAge: 33 } },
};

const runActivity = {
  activityId: 19283746,
  activityName: "Morning Run",
  activityType: { typeKey: "running" },
  startTimeLocal: "2026-07-01 06:12:33",
  distance: 8046.7,
  duration: 2700.5,
  averageHR: 152,
  maxHR: 171,
  calories: 512,
  elevationGain: 42.1,
  aerobicTrainingEffect: 3.2,
  anaerobicTrainingEffect: 0.4,
  activityTrainingLoad: 118,
  averageRunningCadenceInStepsPerMinute: 172,
};

const strengthActivity = {
  activityId: 55511222,
  activityName: "Strength",
  activityType: { typeKey: "strength_training" },
  startTimeLocal: "2026-07-01 17:05:00",
  duration: 3480,
  averageHR: 118,
  maxHR: 154,
  calories: 388,
};

describe("garminDayToCheckin", () => {
  it("maps measured fields and units", () => {
    const input = garminDayToCheckin(wellnessDay);
    expect(input).not.toBeNull();
    expect(input!.steps).toBe(9432);
    expect(input!.restingHr).toBe(47);
    expect(input!.bodyBattery).toBe(92);
    expect(input!.stressScore).toBe(31);
    expect(input!.sleepDuration).toEqual({ value: 25740, unit: "s" });
    expect(input!.sleepScore).toBe(82);
    expect(input!.hrvMs).toBe(58);
  });

  it("maps the extended wellness fields (stages, energy, readiness, vo2max)", () => {
    const input = garminDayToCheckin(wellnessDay);
    expect(input!.bodyBatteryLow).toBe(24);
    expect(input!.activeKcal).toBe(731);
    expect(input!.bmrKcal).toBe(1680);
    expect(input!.intensityMinutesModerate).toBe(45);
    expect(input!.intensityMinutesVigorous).toBe(20);
    expect(input!.respirationAvg).toBe(13.4);
    expect(input!.spo2Avg).toBe(95);
    expect(input!.sleepDeep).toEqual({ value: 5400, unit: "s" });
    expect(input!.sleepLight).toEqual({ value: 15000, unit: "s" });
    expect(input!.sleepRem).toEqual({ value: 5340, unit: "s" });
    expect(input!.sleepAwake).toEqual({ value: 600, unit: "s" });
    expect(input!.trainingReadiness).toBe(74);
    expect(input!.vo2max).toBe(48.0);
  });

  it("falls back to overnight respiration when waking value is absent", () => {
    const input = garminDayToCheckin({
      ...wellnessDay,
      stats: { ...wellnessDay.stats, avgWakingRespirationValue: undefined },
    });
    expect(input!.respirationAvg).toBe(14.1); // sleep.averageRespirationValue
  });

  it("returns null for a day with no usable data (watch not worn)", () => {
    expect(
      garminDayToCheckin({
        date: "2026-07-01",
        stats: { totalSteps: 0, restingHeartRate: 0, averageStressLevel: -1 },
        sleep: null,
        hrv: null,
      }),
    ).toBeNull();
  });
});

describe("importGarminData — wellness", () => {
  it("overwrites measured fields, preserves subjective ones", async () => {
    // Scott's morning check-in: rough numbers + subjective fields.
    await upsertDailyCheckin(db, ctx, {
      date: "2026-07-01",
      sleepDuration: { value: 7.2, unit: "h" },
      energy: 4,
      notes: "felt rested",
    });

    const summary = await importGarminData(db, ctx, {
      days: [wellnessDay],
      activities: [],
    });
    expect(summary.days.updated).toEqual(["2026-07-01"]);

    const metrics = await getDailyMetrics(db, ctx, "2026-07-01");
    expect(metrics?.sleepDurationS).toBe(25740); // Garmin's measured value won
    expect(metrics?.hrvMs).toBe(58);
    expect(metrics?.steps).toBe(9432);
    expect(metrics?.sleepDeepS).toBe(5400); // extended fields persist
    expect(metrics?.activeKcal).toBe(731);
    expect(metrics?.trainingReadiness).toBe(74);
    expect(metrics?.vo2max).toBe(48.0);
    expect(metrics?.energySubjective).toBe(4); // subjective preserved
    expect(metrics?.notes).toBe("felt rested");
  });

  it("skips days with nothing usable", async () => {
    const summary = await importGarminData(db, ctx, {
      days: [{ date: "2026-07-03", stats: {}, sleep: null, hrv: null }],
      activities: [],
    });
    expect(summary.days.skipped).toEqual(["2026-07-03"]);
    expect(await getDailyMetrics(db, ctx, "2026-07-03")).toBeUndefined();
  });
});

describe("importGarminData — activities", () => {
  it("creates a run session with block detail and derived pace", async () => {
    const summary = await importGarminData(db, ctx, { days: [], activities: [runActivity] });
    expect(summary.activities.created).toHaveLength(1);
    expect(summary.activities.created[0]!.sourceRef).toBe("garmin:19283746");

    const sessions = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, ctx.userId));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.source).toBe("garmin_export");
    expect(sessions[0]!.title).toBe("Morning Run");
    expect(sessions[0]!.avgHr).toBe(152);
    // Training effect/load + running dynamics land in session extras.
    expect(sessions[0]!.extras).toMatchObject({
      aerobicTrainingEffect: 3.2,
      anaerobicTrainingEffect: 0.4,
      trainingLoad: 118,
      avgRunCadence: 172,
    });

    const blocks = await db
      .select()
      .from(workoutBlocks)
      .where(eq(workoutBlocks.sessionId, sessions[0]!.id));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.blockType).toBe("run");
    expect(blocks[0]!.distanceM).toBeCloseTo(8046.7, 1);
    // 2700s over 8.0467km ≈ 335.5 s/km
    expect(blocks[0]!.avgPaceSPerKm).toBeCloseTo(335.5, 0);
  });

  it("is idempotent — re-importing the same activity skips", async () => {
    await importGarminData(db, ctx, { days: [], activities: [runActivity] });
    const again = await importGarminData(db, ctx, { days: [], activities: [runActivity] });
    expect(again.activities.skipped).toHaveLength(1);
    expect(again.activities.created).toHaveLength(0);

    const sessions = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, ctx.userId));
    expect(sessions).toHaveLength(1);
  });

  it("enriches a same-day conversational strength session instead of duplicating", async () => {
    const logged = await logWorkout(db, ctx, {
      date: "2026-07-01",
      time: "17:00",
      title: "Lower strength",
      blocks: [
        {
          type: "strength" as const,
          movements: [
            {
              name: "back squat",
              sets: [{ reps: 5, load: { value: 225, unit: "lb" as const } }],
            },
          ],
        },
      ],
    });
    expect(logged.status).toBe("logged");

    const summary = await importGarminData(db, ctx, {
      days: [],
      activities: [strengthActivity],
    });
    expect(summary.activities.enriched).toHaveLength(1);

    const sessions = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, ctx.userId));
    expect(sessions).toHaveLength(1); // no second session
    expect(sessions[0]!.source).toBe("conversation"); // conversational log stays canonical
    expect(sessions[0]!.sourceRef).toBe("garmin:55511222");
    expect(sessions[0]!.avgHr).toBe(118); // measured HR filled in
    expect(sessions[0]!.durationS).toBe(3480);

    // Re-import after enrichment → skipped via the stamped source_ref.
    const again = await importGarminData(db, ctx, { days: [], activities: [strengthActivity] });
    expect(again.activities.skipped).toHaveLength(1);
  });

  it("defers a strength activity with no conversational session yet", async () => {
    const summary = await importGarminData(db, ctx, {
      days: [],
      activities: [strengthActivity],
    });
    expect(summary.activities.deferredStrength).toHaveLength(1);
    const sessions = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, ctx.userId));
    expect(sessions).toHaveLength(0); // never created from watch data alone
  });

  it("enriches a same-day conversational run rather than creating a duplicate", async () => {
    await logWorkout(db, ctx, {
      date: "2026-07-01",
      blocks: [
        {
          type: "run" as const,
          distance: { value: 5, unit: "mi" as const },
          movements: [{ name: "run" }],
        },
      ],
    });

    const summary = await importGarminData(db, ctx, { days: [], activities: [runActivity] });
    expect(summary.activities.enriched).toHaveLength(1);

    const sessions = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, ctx.userId));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.avgHr).toBe(152);

    const blocks = await db
      .select()
      .from(workoutBlocks)
      .where(eq(workoutBlocks.sessionId, sessions[0]!.id));
    // Distance was logged conversationally (kept); duration/HR came from Garmin.
    expect(blocks[0]!.distanceM).toBeCloseTo(8046.72, 0);
    expect(blocks[0]!.durationS).toBe(2701);
    expect(blocks[0]!.avgHr).toBe(152);
  });

  it("maps unknown activity types to a movement-less 'other' block", async () => {
    const summary = await importGarminData(db, ctx, {
      days: [],
      activities: [
        {
          activityId: 777,
          activityType: { typeKey: "indoor_cardio" },
          startTimeLocal: "2026-07-02 08:00:00",
          duration: 1200,
          averageHR: 133,
        },
      ],
    });
    expect(summary.activities.created).toHaveLength(1);
    const sessions = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.sourceRef, "garmin:777"));
    expect(sessions).toHaveLength(1);
    const blocks = await db
      .select()
      .from(workoutBlocks)
      .where(eq(workoutBlocks.sessionId, sessions[0]!.id));
    expect(blocks[0]!.blockType).toBe("other");
  });
});
