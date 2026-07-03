import { and, eq } from "drizzle-orm";
import type { Db, UserCtx } from "../db/client.js";
import { bodyMeasurements, dailyMetrics } from "../db/schema.js";
import type { LogDailyCheckinInput } from "../schemas/inputs.js";
import { todayIn, zonedToUtc } from "../time.js";
import { toKg, toSeconds } from "../units.js";

export type DailyMetrics = typeof dailyMetrics.$inferSelect;
export type BodyMeasurement = typeof bodyMeasurements.$inferSelect;

/** Nominal local time assigned to morning weigh-ins logged without a time. */
const WEIGH_IN_TIME = "07:00";

/**
 * Upsert semantics per specs/01-initial-platform/SPEC.md §5.9: the natural key is (user_id, local_date)
 * and only the fields present in this check-in are written on conflict —
 * re-logging updates what you said, preserves what you didn't. A later Garmin
 * import (which supplies only measured fields) merges the same way, leaving
 * subjective fields intact.
 */
export async function upsertDailyCheckin(
  db: Db,
  ctx: UserCtx,
  input: LogDailyCheckinInput,
): Promise<{ metrics: DailyMetrics; weighIn: BodyMeasurement | null }> {
  const localDate = input.date ?? todayIn(ctx.timezone);

  const provided: Partial<typeof dailyMetrics.$inferInsert> = {};
  if (input.sleepDuration !== undefined)
    provided.sleepDurationS = Math.round(toSeconds(input.sleepDuration));
  if (input.sleepScore !== undefined) provided.sleepScore = input.sleepScore;
  if (input.sleepQuality !== undefined) provided.sleepQualitySubjective = input.sleepQuality;
  if (input.sleepDeep !== undefined) provided.sleepDeepS = Math.round(toSeconds(input.sleepDeep));
  if (input.sleepLight !== undefined) provided.sleepLightS = Math.round(toSeconds(input.sleepLight));
  if (input.sleepRem !== undefined) provided.sleepRemS = Math.round(toSeconds(input.sleepRem));
  if (input.sleepAwake !== undefined) provided.sleepAwakeS = Math.round(toSeconds(input.sleepAwake));
  if (input.hrvMs !== undefined) provided.hrvMs = input.hrvMs;
  if (input.restingHr !== undefined) provided.restingHr = input.restingHr;
  if (input.steps !== undefined) provided.steps = input.steps;
  if (input.bodyBattery !== undefined) provided.bodyBattery = input.bodyBattery;
  if (input.bodyBatteryLow !== undefined) provided.bodyBatteryLow = input.bodyBatteryLow;
  if (input.stressScore !== undefined) provided.stressScore = input.stressScore;
  if (input.respirationAvg !== undefined) provided.respirationAvg = input.respirationAvg;
  if (input.spo2Avg !== undefined) provided.spo2Avg = input.spo2Avg;
  if (input.activeKcal !== undefined) provided.activeKcal = input.activeKcal;
  if (input.bmrKcal !== undefined) provided.bmrKcal = input.bmrKcal;
  if (input.intensityMinutesModerate !== undefined)
    provided.intensityMinutesModerate = input.intensityMinutesModerate;
  if (input.intensityMinutesVigorous !== undefined)
    provided.intensityMinutesVigorous = input.intensityMinutesVigorous;
  if (input.trainingReadiness !== undefined) provided.trainingReadiness = input.trainingReadiness;
  if (input.vo2max !== undefined) provided.vo2max = input.vo2max;
  if (input.energy !== undefined) provided.energySubjective = input.energy;
  if (input.sorenessNotes !== undefined) provided.sorenessNotes = input.sorenessNotes;
  if (input.notes !== undefined) provided.notes = input.notes;

  const rows = await db
    .insert(dailyMetrics)
    .values({ userId: ctx.userId, localDate, source: "checkin", ...provided })
    .onConflictDoUpdate({
      target: [dailyMetrics.userId, dailyMetrics.localDate],
      set: { ...provided, updatedAt: new Date() },
    })
    .returning();
  const metrics = rows[0];
  if (!metrics) throw new Error("daily_metrics upsert returned no row");

  let weighIn: BodyMeasurement | null = null;
  if (input.weight !== undefined || input.bodyFatPct !== undefined) {
    const measuredAt = zonedToUtc(localDate, WEIGH_IN_TIME, ctx.timezone);
    const values: Partial<typeof bodyMeasurements.$inferInsert> = {};
    if (input.weight !== undefined) values.weightKg = toKg(input.weight);
    if (input.bodyFatPct !== undefined) values.bodyFatPct = input.bodyFatPct;
    const wRows = await db
      .insert(bodyMeasurements)
      .values({ userId: ctx.userId, measuredAt, source: "checkin", ...values })
      .onConflictDoUpdate({
        target: [bodyMeasurements.userId, bodyMeasurements.measuredAt, bodyMeasurements.source],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    weighIn = wRows[0] ?? null;
  }

  return { metrics, weighIn };
}

export async function getDailyMetrics(
  db: Db,
  ctx: UserCtx,
  localDate: string,
): Promise<DailyMetrics | undefined> {
  const rows = await db
    .select()
    .from(dailyMetrics)
    .where(and(eq(dailyMetrics.userId, ctx.userId), eq(dailyMetrics.localDate, localDate)));
  return rows[0];
}
