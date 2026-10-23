import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db, UserCtx } from "../src/db/client.js";
import { bodyMeasurements, workoutBlocks, workoutSessions } from "../src/db/schema.js";
import {
  garminDayToCheckin,
  garminWeighInToMeasurement,
  importGarminData,
} from "../src/import/garmin.js";
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

// Shaped exactly like a live get_weigh_ins allWeightMetrics entry (manual
// entry, 2026-10-23 07:23 America/New_York) — see specs/06-garmin-weigh-ins §10.
// Note `date` is local wall-clock encoded as UTC and must be ignored.
const manualWeighIn = {
  samplePk: 1792754614878,
  date: 1792740209005,
  calendarDate: "2026-10-23",
  weight: 70397.0,
  bmi: null,
  bodyFat: null,
  bodyWater: null,
  boneMass: null,
  muscleMass: null,
  physiqueRating: null,
  visceralFat: null,
  metabolicAge: null,
  sourceType: "MANUAL",
  timestampGMT: 1792754609005,
  weightDelta: null,
};

// Index-scale reading (no live sample yet; field names per the same shape).
const scaleWeighIn = {
  ...manualWeighIn,
  samplePk: 1792668385118,
  calendarDate: "2026-10-22",
  timestampGMT: 1792668380004,
  weight: 70760.0,
  bmi: 22.4,
  bodyFat: 18.2,
  bodyWater: 58.1,
  boneMass: 3100.0,
  muscleMass: 32000.0,
  sourceType: "INDEX_SCALE",
};

const weighInWindow = (entries: Record<string, unknown>[]) => ({
  start: "2026-10-17",
  end: "2026-10-23",
  entries,
});

async function garminWeighIns() {
  return db
    .select()
    .from(bodyMeasurements)
    .where(eq(bodyMeasurements.source, "garmin_export"))
    .orderBy(bodyMeasurements.measuredAt);
}

describe("garminWeighInToMeasurement", () => {
  it("maps grams to kg at the real GMT timestamp, ignoring the local-as-UTC `date`", () => {
    const m = garminWeighInToMeasurement(manualWeighIn, ctx.timezone);
    expect(m).not.toBeNull();
    expect(m!.measuredAt.toISOString()).toBe("2026-10-23T11:23:29.005Z"); // 07:23 EDT
    expect(m!.weightKg).toBeCloseTo(70.397, 6);
    expect(m!.bodyFatPct).toBeUndefined();
    expect(m!.extras).toEqual({
      garminSamplePk: 1792754614878,
      garminCalendarDate: "2026-10-23",
      sourceType: "MANUAL",
    });
  });

  it("falls back to calendarDate at the nominal 07:00 local weigh-in time", () => {
    const m = garminWeighInToMeasurement(
      { ...manualWeighIn, timestampGMT: null },
      ctx.timezone,
    );
    expect(m!.measuredAt.toISOString()).toBe("2026-10-23T11:00:00.000Z");
  });

  it("captures index-scale body fat and keeps scale body comp in extras", () => {
    const m = garminWeighInToMeasurement(scaleWeighIn, ctx.timezone);
    expect(m!.bodyFatPct).toBe(18.2);
    expect(m!.extras).toEqual({
      garminSamplePk: 1792668385118,
      garminCalendarDate: "2026-10-22",
      sourceType: "INDEX_SCALE",
      bmi: 22.4,
      bodyWaterPct: 58.1,
      muscleMassKg: 32,
      boneMassKg: 3.1,
    });
  });

  it("returns null for unusable entries", () => {
    for (const weight of [0, -1, null, undefined]) {
      expect(garminWeighInToMeasurement({ ...manualWeighIn, weight }, ctx.timezone)).toBeNull();
    }
    expect(
      garminWeighInToMeasurement(
        { ...manualWeighIn, timestampGMT: null, calendarDate: null },
        ctx.timezone,
      ),
    ).toBeNull();
  });
});

describe("importGarminData — weigh-ins", () => {
  it("upserts weigh-ins as garmin_export body measurements", async () => {
    const summary = await importGarminData(db, ctx, {
      days: [],
      activities: [],
      weighIns: weighInWindow([manualWeighIn, scaleWeighIn, { ...manualWeighIn, weight: 0 }]),
    });
    expect(summary.weighIns.upserted).toEqual([
      "2026-10-23T11:23:29.005Z",
      "2026-10-22T11:26:20.004Z",
    ]);
    expect(summary.weighIns.skipped).toBe(1);

    const rows = await garminWeighIns();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.userId).toBe(ctx.userId);
    expect(rows[0]!.weightKg).toBeCloseTo(70.76, 6);
    expect(rows[0]!.bodyFatPct).toBe(18.2);
    // Scale bone mass is a BIA estimate — never DEXA bone mineral content.
    expect(rows[0]!.boneMineralContentKg).toBeNull();
    expect(rows[1]!.weightKg).toBeCloseTo(70.397, 6);
  });

  it("is idempotent on re-import and applies Garmin-side edits in place", async () => {
    const payload = { days: [], activities: [], weighIns: weighInWindow([manualWeighIn]) };
    await importGarminData(db, ctx, payload);
    await importGarminData(db, ctx, payload);
    expect(await garminWeighIns()).toHaveLength(1);

    await importGarminData(db, ctx, {
      ...payload,
      weighIns: weighInWindow([{ ...manualWeighIn, weight: 70100.0 }]),
    });
    const rows = await garminWeighIns();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.weightKg).toBeCloseTo(70.1, 6);
  });

  it("coexists with a same-day check-in weigh-in", async () => {
    await upsertDailyCheckin(db, ctx, {
      date: "2026-10-23",
      weight: { value: 155.2, unit: "lb" },
    });
    await importGarminData(db, ctx, {
      days: [],
      activities: [],
      weighIns: weighInWindow([manualWeighIn]),
    });
    const all = await db
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, ctx.userId));
    expect(all.map((r) => r.source).sort()).toEqual(["checkin", "garmin_export"]);
  });

  it("reports an empty weigh-in summary when the payload has no weighIns", async () => {
    const summary = await importGarminData(db, ctx, { days: [], activities: [] });
    expect(summary.weighIns).toEqual({ upserted: [], deleted: 0, skipped: 0 });
    expect(await garminWeighIns()).toHaveLength(0);
  });
});

describe("importGarminData — weigh-in delete reconciliation", () => {
  // Window 2026-10-17..2026-10-23, judged by Garmin's own calendarDate — the
  // date Garmin used to answer the range query — not Corpus's timezone.
  const at = (iso: string) => new Date(iso);

  async function seedGarmin(measuredAt: Date, garminCalendarDate?: string) {
    await db.insert(bodyMeasurements).values({
      userId: ctx.userId,
      measuredAt,
      source: "garmin_export",
      weightKg: 70,
      extras: garminCalendarDate ? { garminCalendarDate } : null,
    });
  }

  async function remaining() {
    const rows = await db
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, ctx.userId))
      .orderBy(bodyMeasurements.measuredAt);
    return rows.map((r) => `${r.source}@${r.measuredAt.toISOString()}`);
  }

  it("deletes garmin_export rows in the window that Garmin no longer has", async () => {
    await seedGarmin(at("2026-10-20T11:41:17.007Z"), "2026-10-20"); // deleted in Garmin since
    const summary = await importGarminData(db, ctx, {
      days: [],
      activities: [],
      weighIns: weighInWindow([manualWeighIn]),
    });
    expect(summary.weighIns.deleted).toBe(1);
    expect(await remaining()).toEqual(["garmin_export@2026-10-23T11:23:29.005Z"]);
  });

  it("bounds the window by Garmin's calendarDate and never touches other sources", async () => {
    // Late on 10-23 per Garmin (03:30Z on 10-24): inside the window → deleted.
    await seedGarmin(at("2026-10-24T03:30:00.000Z"), "2026-10-23");
    // 10-16 per Garmin: before the window → kept. Note 04:30Z is 00:30 on
    // 10-17 in Corpus's America/New_York, so a Corpus-timezone window would
    // wrongly delete it if Garmin's clock is set to a zone further west.
    await seedGarmin(at("2026-10-17T04:30:00.000Z"), "2026-10-16");
    // 10-24 per Garmin: after the window → kept.
    await seedGarmin(at("2026-10-24T04:30:00.000Z"), "2026-10-24");
    // No calendarDate recorded: unknowable, so conservatively kept.
    await seedGarmin(at("2026-10-20T12:00:00.000Z"));
    // Other sources inside the window → kept.
    await upsertDailyCheckin(db, ctx, { date: "2026-10-21", weight: { value: 157, unit: "lb" } });
    await db.insert(bodyMeasurements).values({
      userId: ctx.userId,
      measuredAt: at("2026-10-19T14:00:00.000Z"),
      source: "document_extraction",
      weightKg: 71.2,
      boneMineralContentKg: 3.0,
    });

    const summary = await importGarminData(db, ctx, {
      days: [],
      activities: [],
      weighIns: weighInWindow([]),
    });
    expect(summary.weighIns.deleted).toBe(1);
    expect(await remaining()).toEqual([
      "garmin_export@2026-10-17T04:30:00.000Z",
      "document_extraction@2026-10-19T14:00:00.000Z",
      "garmin_export@2026-10-20T12:00:00.000Z",
      "checkin@2026-10-21T11:00:00.000Z",
      "garmin_export@2026-10-24T04:30:00.000Z",
    ]);
  });

  it("deletes nothing when the payload has no weighIns (fetch failed)", async () => {
    await seedGarmin(at("2026-10-20T11:41:17.007Z"), "2026-10-20");
    const summary = await importGarminData(db, ctx, { days: [], activities: [] });
    expect(summary.weighIns.deleted).toBe(0);
    expect(await remaining()).toHaveLength(1);
  });

  it("keeps rows still present in Garmin across re-runs", async () => {
    const payload = { days: [], activities: [], weighIns: weighInWindow([manualWeighIn]) };
    await importGarminData(db, ctx, payload);
    const again = await importGarminData(db, ctx, payload);
    expect(again.weighIns.deleted).toBe(0);
    expect(await remaining()).toEqual(["garmin_export@2026-10-23T11:23:29.005Z"]);
  });

  it("only reconciles the importing user's rows", async () => {
    const other = await createTestUser(db, { email: "someone@example.com" });
    await db.insert(bodyMeasurements).values({
      userId: other.userId,
      measuredAt: at("2026-10-20T11:41:17.007Z"),
      source: "garmin_export",
      weightKg: 60,
      extras: { garminCalendarDate: "2026-10-20" },
    });
    await importGarminData(db, ctx, { days: [], activities: [], weighIns: weighInWindow([]) });
    const otherRows = await db
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.userId, other.userId));
    expect(otherRows).toHaveLength(1);
  });
});
