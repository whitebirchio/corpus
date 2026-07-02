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
}): LogDailyCheckinInput | null {
  const stats = day.stats ?? {};
  const input: LogDailyCheckinInput = { date: day.date };
  let any = false;

  const steps = num(stats.totalSteps);
  if (steps !== undefined && steps > 0) {
    input.steps = Math.round(steps);
    any = true;
  }
  const rhr = num(stats.restingHeartRate);
  if (rhr !== undefined && rhr > 0) {
    input.restingHr = Math.round(rhr);
    any = true;
  }
  const bodyBattery = num(stats.bodyBatteryHighestValue);
  if (bodyBattery !== undefined && bodyBattery > 0) {
    input.bodyBattery = clamp(bodyBattery, 0, 100);
    any = true;
  }
  const stress = num(stats.averageStressLevel);
  if (stress !== undefined && stress >= 0) {
    input.stressScore = clamp(stress, 0, 100);
    any = true;
  }
  const sleepS = num(day.sleep?.sleepTimeSeconds);
  if (sleepS !== undefined && sleepS > 0) {
    input.sleepDuration = { value: sleepS, unit: "s" };
    any = true;
  }
  const scores = day.sleep?.sleepScores as { overall?: { value?: unknown } } | undefined;
  const sleepScore = num(scores?.overall?.value);
  if (sleepScore !== undefined && sleepScore > 0) {
    input.sleepScore = clamp(sleepScore, 0, 100);
    any = true;
  }
  const hrv = num(day.hrv?.lastNightAvg);
  if (hrv !== undefined && hrv > 0) {
    input.hrvMs = hrv;
    any = true;
  }

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
