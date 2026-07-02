import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db, UserCtx } from "../db/client.js";
import { bodyMeasurements, observations } from "../db/schema.js";
import { getDailyMetrics, type DailyMetrics } from "./checkins.js";
import { getActiveGoals, getActiveInsights, type Goal, type Insight } from "./goals.js";
import { getDayNutrition, type DayNutrition } from "./meals.js";
import { getActiveRegimen, type RegimenItem } from "./regimen.js";
import { getRecentWorkouts, muscleGroupVolume, type RecentWorkout } from "./workouts.js";
import { todayIn } from "../time.js";

/**
 * The morning-briefing payload (SPEC.md §6.2 get_daily_summary): one call
 * primes any daily conversation with recovery, nutrition, training recency,
 * goals, regimen, and standing insights.
 */
export interface DailySummary {
  date: string;
  metrics: DailyMetrics | null;
  nutrition: DayNutrition;
  recentWorkouts: Array<{
    date: string;
    title: string | null;
    blockTypes: string[];
    movements: string[];
    muscleGroups: string[];
    sessionRpe: number | null;
    durationS: number | null;
  }>;
  muscleGroupVolume7d: Record<string, number>;
  latestWeightKg: number | null;
  goals: Goal[];
  regimen: RegimenItem[];
  insights: Insight[];
  todaysObservations: Array<{ kind: string; value: number | null; text: string }>;
}

export async function getDailySummary(db: Db, ctx: UserCtx, date?: string): Promise<DailySummary> {
  const localDate = date ?? todayIn(ctx.timezone);

  const [metrics, nutrition, recent, volume, goals, regimen, activeInsights] = await Promise.all([
    getDailyMetrics(db, ctx, localDate),
    getDayNutrition(db, ctx, localDate),
    getRecentWorkouts(db, ctx, 10),
    muscleGroupVolume(db, ctx, 7),
    getActiveGoals(db, ctx),
    getActiveRegimen(db, ctx),
    getActiveInsights(db, ctx),
  ]);

  const weightRows = await db
    .select({ weightKg: bodyMeasurements.weightKg, measuredAt: bodyMeasurements.measuredAt })
    .from(bodyMeasurements)
    .where(and(eq(bodyMeasurements.userId, ctx.userId), isNotNull(bodyMeasurements.weightKg)))
    .orderBy(desc(bodyMeasurements.measuredAt))
    .limit(1);

  const todaysObs = await db
    .select()
    .from(observations)
    .where(and(eq(observations.userId, ctx.userId), eq(observations.localDate, localDate)))
    .orderBy(observations.observedAt);

  return {
    date: localDate,
    metrics: metrics ?? null,
    nutrition,
    recentWorkouts: recent.map(mapRecent),
    muscleGroupVolume7d: volume,
    latestWeightKg: weightRows[0]?.weightKg ?? null,
    goals,
    regimen,
    insights: activeInsights,
    todaysObservations: todaysObs.map((o) => ({ kind: o.kind, value: o.valueNum, text: o.text })),
  };
}

function mapRecent(w: RecentWorkout): DailySummary["recentWorkouts"][number] {
  return {
    date: w.session.localDate,
    title: w.session.title,
    blockTypes: w.blockTypes,
    movements: w.movementNames,
    muscleGroups: w.muscleGroups,
    sessionRpe: w.session.sessionRpe,
    durationS: w.session.durationS,
  };
}
