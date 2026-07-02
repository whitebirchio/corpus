/**
 * Garmin Connect importer (SPEC.md §8.4, rescoped 2026-07-02).
 *
 * The nightly sync job (apps/garmin-sync) authenticates with Garmin and
 * forwards the raw JSON it pulled; ALL mapping, unit handling, and
 * reconciliation live here so the write path has exactly one implementation.
 *
 * Reconciliation (§5.9): wellness days flow through upsertDailyCheckin — the
 * measured fields Garmin supplies overwrite, subjective check-in fields are
 * preserved. Activities are keyed by `garmin:<activityId>` in source_ref:
 *   - already imported (any source) → skipped
 *   - same-day conversational session of a compatible type → enriched in
 *     place (null measured fields filled, source_ref stamped) — never a
 *     second session for the same workout
 *   - cardio with no match → created as a garmin_export session
 *   - strength with no match → deferred, never created: the watch only has
 *     timer/HR, the per-set detail comes from conversational logging, and a
 *     later re-run enriches once the session exists (the job pulls a trailing
 *     window, so this self-heals).
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db, UserCtx } from "../db/client.js";
import {
  blockMovements,
  workoutBlocks,
  workoutSessions,
} from "../db/schema.js";
import type { LogDailyCheckinInput } from "../schemas/inputs.js";
import { zonedToUtc } from "../time.js";
import { resolveMovement } from "../repos/movements.js";
import { upsertDailyCheckin } from "../repos/checkins.js";

// --- payload ----------------------------------------------------------------

const rawObject = z.record(z.string(), z.unknown());

export const garminIngestPayload = z.object({
  days: z
    .array(
      z.object({
        date: z.iso.date(),
        stats: rawObject.nullish(),
        sleep: rawObject.nullish(),
        hrv: rawObject.nullish(),
        // get_training_readiness(d)[0] and get_max_metrics(d)[0], forwarded raw.
        trainingReadiness: rawObject.nullish(),
        maxMetrics: rawObject.nullish(),
      }),
    )
    .default([]),
  activities: z.array(rawObject).default([]),
});
export type GarminIngestPayload = z.infer<typeof garminIngestPayload>;

export interface GarminActivityOutcome {
  sourceRef: string;
  type: string;
  date: string | null;
  title: string | null;
}

export interface GarminImportSummary {
  days: { updated: string[]; skipped: string[] };
  activities: {
    created: GarminActivityOutcome[];
    enriched: GarminActivityOutcome[];
    skipped: GarminActivityOutcome[];
    /** Strength sessions with no conversational log yet — retried next run. */
    deferredStrength: GarminActivityOutcome[];
  };
}

// --- helpers ----------------------------------------------------------------

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

// --- wellness ---------------------------------------------------------------

/**
 * Map one day of raw Garmin JSON to check-in input. Garmin uses negative
 * sentinels (-1/-2) for "no data", and days the watch wasn't worn come back
 * with zeros/nulls — anything unusable is simply omitted.
 */
export function garminDayToCheckin(day: {
  date: string;
  stats?: Record<string, unknown> | null;
  sleep?: Record<string, unknown> | null;
  hrv?: Record<string, unknown> | null;
  trainingReadiness?: Record<string, unknown> | null;
  maxMetrics?: Record<string, unknown> | null;
}): LogDailyCheckinInput | null {
  const stats = day.stats ?? {};
  const sleep = day.sleep ?? {};
  const input: LogDailyCheckinInput = { date: day.date };
  let any = false;

  // Screen a raw Garmin number, then store the transformed value. `keep` gates
  // the RAW reading (Garmin signals "no data" with negative sentinels, and an
  // unworn watch reports zeros) — it must run before any clamping, or a -1 gets
  // squashed to a valid-looking 0. Default: strictly positive.
  const put = <K extends keyof LogDailyCheckinInput>(
    key: K,
    raw: unknown,
    transform: (n: number) => LogDailyCheckinInput[K],
    keep: (n: number) => boolean = (n) => n > 0,
  ): void => {
    const v = num(raw);
    if (v === undefined || !keep(v)) return;
    input[key] = transform(v);
    any = true;
  };

  const round = (n: number) => Math.round(n);
  const bounded = (n: number) => clamp(n, 0, 100);
  const seconds = (n: number) => ({ value: n, unit: "s" as const });
  const nonNeg = (n: number) => n >= 0; // 0 is real (e.g. no intensity minutes)

  put("steps", stats.totalSteps, round);
  put("restingHr", stats.restingHeartRate, round);
  put("bodyBattery", stats.bodyBatteryHighestValue, bounded);
  put("bodyBatteryLow", stats.bodyBatteryLowestValue, bounded, nonNeg);
  put("stressScore", stats.averageStressLevel, bounded, nonNeg);
  put("activeKcal", stats.activeKilocalories, round);
  put("bmrKcal", stats.bmrKilocalories, round);
  put("intensityMinutesModerate", stats.moderateIntensityMinutes, round, nonNeg);
  put("intensityMinutesVigorous", stats.vigorousIntensityMinutes, round, nonNeg);
  // Waking respiration; fall back to the overnight average from the sleep DTO.
  put("respirationAvg", stats.avgWakingRespirationValue ?? sleep.averageRespirationValue, (n) => n);
  put("spo2Avg", sleep.averageSpO2Value ?? stats.averageSpo2, round);

  put("sleepDuration", sleep.sleepTimeSeconds, seconds);
  put("sleepDeep", sleep.deepSleepSeconds, seconds);
  put("sleepLight", sleep.lightSleepSeconds, seconds);
  put("sleepRem", sleep.remSleepSeconds, seconds);
  put("sleepAwake", sleep.awakeSleepSeconds, seconds);
  const scores = sleep.sleepScores as { overall?: { value?: unknown } } | undefined;
  put("sleepScore", scores?.overall?.value, bounded);

  put("hrvMs", day.hrv?.lastNightAvg, (n) => n);

  // get_training_readiness(d)[0].score — the composite recovery score.
  put("trainingReadiness", day.trainingReadiness?.score, bounded);
  // get_max_metrics(d)[0].generic.vo2MaxValue — running VO2 max estimate.
  const generic = day.maxMetrics?.generic as { vo2MaxValue?: unknown } | undefined;
  put("vo2max", generic?.vo2MaxValue, (n) => n);

  return any ? input : null;
}

// --- activities -------------------------------------------------------------

type BlockType = "run" | "strength" | "mobility" | "other";

/** Garmin typeKey → block type + catalog movement (undefined = movement-less). */
function classifyActivity(typeKey: string): { block: BlockType; movement?: string } {
  const k = typeKey.toLowerCase();
  if (k.includes("running")) return { block: "run", movement: "run" };
  if (k.includes("strength")) return { block: "strength" };
  if (k.includes("cycling") || k.includes("biking")) return { block: "other", movement: "cycling" };
  if (k.includes("walking")) return { block: "other", movement: "walking" };
  if (k.includes("hiking")) return { block: "other", movement: "hiking" };
  if (k.includes("swimming")) return { block: "other", movement: "swimming" };
  if (k.includes("rowing")) return { block: "other", movement: "rowing" };
  if (k.includes("yoga") || k.includes("pilates") || k.includes("stretch") || k.includes("breathwork"))
    return { block: "mobility" };
  return { block: "other" };
}

interface MappedActivity {
  sourceRef: string;
  typeKey: string;
  classified: { block: BlockType; movement?: string };
  localDate: string;
  time: string; // HH:MM
  title: string | null;
  distanceM?: number;
  durationS?: number;
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  elevationGainM?: number;
  extras?: Record<string, unknown>;
}

/** Compact bag of measured activity metrics that have no first-class column —
 * training effect/load and running dynamics. Returns undefined when empty so
 * we never stamp an empty object onto a session. */
function activityExtras(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const fields: Record<string, unknown> = {
    aerobicTrainingEffect: num(raw.aerobicTrainingEffect),
    anaerobicTrainingEffect: num(raw.anaerobicTrainingEffect),
    trainingLoad: num(raw.activityTrainingLoad),
    trainingEffectLabel: str(raw.trainingEffectLabel),
    avgRunCadence: num(raw.averageRunningCadenceInStepsPerMinute),
    avgPower: num(raw.avgPower),
    avgStrideLengthCm: num(raw.avgStrideLength),
    avgGroundContactTimeMs: num(raw.avgGroundContactTime),
    avgVerticalOscillationCm: num(raw.avgVerticalOscillation),
  };
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) extras[k] = v;
  return Object.keys(extras).length > 0 ? extras : undefined;
}

function mapActivity(raw: Record<string, unknown>): MappedActivity | null {
  const id = num(raw.activityId) ?? str(raw.activityId);
  if (id === undefined) return null;
  // "2026-07-01 06:12:33" — Garmin's startTimeLocal is already in the
  // activity's local timezone, which for a worn watch is the user's.
  const startLocal = str(raw.startTimeLocal);
  const m = startLocal?.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const typeKey = str((raw.activityType as Record<string, unknown> | undefined)?.typeKey) ?? "other";
  const duration = num(raw.duration) ?? num(raw.movingDuration) ?? num(raw.elapsedDuration);
  return {
    sourceRef: `garmin:${id}`,
    typeKey,
    classified: classifyActivity(typeKey),
    localDate: m[1]!,
    time: `${m[2]}:${m[3]}`,
    title: str(raw.activityName) ?? null,
    distanceM: num(raw.distance),
    durationS: duration !== undefined ? Math.round(duration) : undefined,
    avgHr: num(raw.averageHR) !== undefined ? Math.round(num(raw.averageHR)!) : undefined,
    maxHr: num(raw.maxHR) !== undefined ? Math.round(num(raw.maxHR)!) : undefined,
    calories: num(raw.calories) !== undefined ? Math.round(num(raw.calories)!) : undefined,
    elevationGainM: num(raw.elevationGain),
    extras: activityExtras(raw),
  };
}

/** Same-day conversational sessions (no source_ref yet) that contain a block
 * of the given type — the enrichment candidates, oldest first. */
async function findEnrichableSession(
  db: Db,
  ctx: UserCtx,
  localDate: string,
  blockType: BlockType,
): Promise<{ sessionId: string; blockIds: string[] } | null> {
  const sessions = await db
    .select()
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, ctx.userId),
        eq(workoutSessions.localDate, localDate),
        eq(workoutSessions.source, "conversation"),
        isNull(workoutSessions.sourceRef),
      ),
    )
    .orderBy(asc(workoutSessions.startedAt));
  if (sessions.length === 0) return null;

  const blocks = await db
    .select()
    .from(workoutBlocks)
    .where(
      inArray(
        workoutBlocks.sessionId,
        sessions.map((s) => s.id),
      ),
    );
  for (const s of sessions) {
    const matching = blocks.filter((b) => b.sessionId === s.id && b.blockType === blockType);
    if (matching.length > 0) return { sessionId: s.id, blockIds: matching.map((b) => b.id) };
  }
  return null;
}

async function enrichSession(
  db: Db,
  ctx: UserCtx,
  target: { sessionId: string; blockIds: string[] },
  a: MappedActivity,
): Promise<void> {
  const sessionRows = await db
    .select()
    .from(workoutSessions)
    .where(eq(workoutSessions.id, target.sessionId));
  const s = sessionRows[0];
  if (!s) return;

  // Measured fields fill gaps only — the conversational log stays canonical.
  await db
    .update(workoutSessions)
    .set({
      sourceRef: a.sourceRef,
      durationS: s.durationS ?? a.durationS,
      avgHr: s.avgHr ?? a.avgHr,
      maxHr: s.maxHr ?? a.maxHr,
      calories: s.calories ?? a.calories,
      extras: s.extras ?? a.extras,
      updatedAt: new Date(),
    })
    .where(eq(workoutSessions.id, s.id));

  // Only fill block-level detail when the target is unambiguous.
  if (target.blockIds.length === 1) {
    const blockRows = await db
      .select()
      .from(workoutBlocks)
      .where(eq(workoutBlocks.id, target.blockIds[0]!));
    const b = blockRows[0];
    if (!b) return;
    const distanceM = b.distanceM ?? a.distanceM;
    const durationS = b.durationS ?? a.durationS;
    let avgPaceSPerKm = b.avgPaceSPerKm;
    if (avgPaceSPerKm == null && distanceM && durationS && distanceM > 0) {
      avgPaceSPerKm = durationS / (distanceM / 1000);
    }
    await db
      .update(workoutBlocks)
      .set({
        distanceM,
        durationS,
        avgPaceSPerKm,
        avgHr: b.avgHr ?? a.avgHr,
        maxHr: b.maxHr ?? a.maxHr,
        elevationGainM: b.elevationGainM ?? a.elevationGainM,
      })
      .where(eq(workoutBlocks.id, b.id));
  }
}

async function createSessionFromActivity(db: Db, ctx: UserCtx, a: MappedActivity): Promise<void> {
  const startedAt = zonedToUtc(a.localDate, a.time, ctx.timezone);
  const sessionRows = await db
    .insert(workoutSessions)
    .values({
      userId: ctx.userId,
      startedAt,
      localDate: a.localDate,
      title: a.title,
      source: "garmin_export",
      sourceRef: a.sourceRef,
      durationS: a.durationS,
      avgHr: a.avgHr,
      maxHr: a.maxHr,
      calories: a.calories,
      extras: a.extras,
    })
    .returning();
  const s = sessionRows[0];
  if (!s) throw new Error("workout_sessions insert returned no row");

  let avgPaceSPerKm: number | undefined;
  if (a.distanceM && a.durationS && a.distanceM > 0) {
    avgPaceSPerKm = a.durationS / (a.distanceM / 1000);
  }
  const blockRows = await db
    .insert(workoutBlocks)
    .values({
      userId: ctx.userId,
      sessionId: s.id,
      seq: 0,
      blockType: a.classified.block,
      distanceM: a.distanceM,
      durationS: a.durationS,
      avgPaceSPerKm,
      avgHr: a.avgHr,
      maxHr: a.maxHr,
      elevationGainM: a.elevationGainM,
    })
    .returning();
  const b = blockRows[0];
  if (!b) throw new Error("workout_blocks insert returned no row");

  if (a.classified.movement) {
    const { movement } = await resolveMovement(db, a.classified.movement, {
      category: "monostructural",
      primaryMuscles: ["cardio"],
    });
    await db.insert(blockMovements).values({
      userId: ctx.userId,
      blockId: b.id,
      movementId: movement.id,
      seq: 0,
    });
  }
}

// --- entry point ------------------------------------------------------------

/**
 * Import one sync payload. The caller wraps this in an RLS-scoped
 * transaction (withUserDb); everything in a payload lands atomically, and
 * re-sending any window is safe.
 */
export async function importGarminData(
  db: Db,
  ctx: UserCtx,
  payload: GarminIngestPayload,
): Promise<GarminImportSummary> {
  const summary: GarminImportSummary = {
    days: { updated: [], skipped: [] },
    activities: { created: [], enriched: [], skipped: [], deferredStrength: [] },
  };

  for (const day of payload.days) {
    const checkin = garminDayToCheckin(day);
    if (!checkin) {
      summary.days.skipped.push(day.date);
      continue;
    }
    await upsertDailyCheckin(db, ctx, checkin);
    summary.days.updated.push(day.date);
  }

  for (const raw of payload.activities) {
    const a = mapActivity(raw);
    if (!a) continue; // no id or unparseable start time — nothing stable to key on
    const outcome: GarminActivityOutcome = {
      sourceRef: a.sourceRef,
      type: a.typeKey,
      date: a.localDate,
      title: a.title,
    };

    const existing = await db
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(
        and(eq(workoutSessions.userId, ctx.userId), eq(workoutSessions.sourceRef, a.sourceRef)),
      );
    if (existing.length > 0) {
      summary.activities.skipped.push(outcome);
      continue;
    }

    const target = await findEnrichableSession(db, ctx, a.localDate, a.classified.block);
    if (target) {
      await enrichSession(db, ctx, target, a);
      summary.activities.enriched.push(outcome);
      continue;
    }

    if (a.classified.block === "strength") {
      summary.activities.deferredStrength.push(outcome);
      continue;
    }

    await createSessionFromActivity(db, ctx, a);
    summary.activities.created.push(outcome);
  }

  return summary;
}
