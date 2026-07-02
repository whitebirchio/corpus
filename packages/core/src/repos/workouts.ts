import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { Db, UserCtx } from "../db/client.js";
import {
  blockMovements,
  movements,
  strengthSets,
  workoutBlocks,
  workoutSessions,
} from "../db/schema.js";
import type { LogWorkoutInput } from "../schemas/inputs.js";
import { localDateOf, todayIn, zonedToUtc } from "../time.js";
import { toKg, toMeters, toSeconds, toSecondsPerKm } from "../units.js";
import { normalizeMovementName, resolveMovement } from "./movements.js";

export type WorkoutSession = typeof workoutSessions.$inferSelect;

export interface DuplicateCandidate {
  sessionId: string;
  title: string | null;
  startedAt: Date;
  blockTypes: string[];
  movementNames: string[];
}

export interface LoggedWorkout {
  session: WorkoutSession;
  blockCount: number;
  movementNames: string[];
  createdMovements: string[]; // catalog additions needing review
}

export type LogWorkoutResult =
  | { status: "logged"; workout: LoggedWorkout }
  | { status: "possible_duplicate"; candidates: DuplicateCandidate[] };

/**
 * SPEC.md §5.9 tier 3: conversationally-logged workouts have no natural key,
 * so before inserting we look for a same-day near-match (shared movements, or
 * same block-type mix for movement-less sessions like plain runs). If found
 * and allowDuplicate is not set, we return the candidates so the agent can ask.
 */
export async function logWorkout(
  db: Db,
  ctx: UserCtx,
  input: LogWorkoutInput,
): Promise<LogWorkoutResult> {
  const localDate = input.date ?? todayIn(ctx.timezone);
  const startedAt = input.time
    ? zonedToUtc(localDate, input.time, ctx.timezone)
    : input.date
      ? zonedToUtc(localDate, "12:00", ctx.timezone)
      : new Date();

  const inputMovementNames = (input.blocks ?? [])
    .flatMap((b) => b.movements ?? [])
    .map((m) => normalizeMovementName(m.name));
  const inputBlockTypes = [...new Set(input.blocks.map((b) => b.type))].sort();

  if (!input.allowDuplicate) {
    const candidates = await findDuplicateCandidates(
      db,
      ctx,
      localDate,
      inputMovementNames,
      inputBlockTypes,
    );
    if (candidates.length > 0) return { status: "possible_duplicate", candidates };
  }

  const createdMovements: string[] = [];

  const session = await db.transaction(async (tx) => {
    const sessionRows = await tx
      .insert(workoutSessions)
      .values({
        userId: ctx.userId,
        startedAt,
        localDate,
        title: input.title,
        source: "conversation",
        durationS: input.duration ? Math.round(toSeconds(input.duration)) : undefined,
        sessionRpe: input.sessionRpe !== undefined ? Math.round(input.sessionRpe) : undefined,
        avgHr: input.avgHr,
        maxHr: input.maxHr,
        calories: input.calories,
        notes: input.notes,
      })
      .returning();
    const s = sessionRows[0];
    if (!s) throw new Error("workout_sessions insert returned no row");

    for (const [bi, block] of input.blocks.entries()) {
      const distanceM = block.distance ? toMeters(block.distance) : undefined;
      const durationS = block.duration ? Math.round(toSeconds(block.duration)) : undefined;
      let avgPaceSPerKm = block.pace ? toSecondsPerKm(block.pace) : undefined;
      if (avgPaceSPerKm === undefined && distanceM && durationS && distanceM > 0) {
        avgPaceSPerKm = durationS / (distanceM / 1000);
      }

      const blockRows = await tx
        .insert(workoutBlocks)
        .values({
          userId: ctx.userId,
          sessionId: s.id,
          seq: bi,
          blockType: block.type,
          scheme: block.scheme,
          roundsPlanned: block.roundsPlanned,
          timeCapS: block.timeCap ? Math.round(toSeconds(block.timeCap)) : undefined,
          intervalS: block.interval ? Math.round(toSeconds(block.interval)) : undefined,
          resultTimeS: block.resultTime ? Math.round(toSeconds(block.resultTime)) : undefined,
          resultRounds: block.resultRounds,
          resultReps: block.resultReps,
          rx: block.rx,
          distanceM,
          durationS,
          avgPaceSPerKm,
          avgHr: block.avgHr,
          maxHr: block.maxHr,
          elevationGainM: block.elevationGain ? toMeters(block.elevationGain) : undefined,
          splits: block.splits,
          rpe: block.rpe !== undefined ? Math.round(block.rpe) : undefined,
          notes: block.notes,
        })
        .returning();
      const b = blockRows[0];
      if (!b) throw new Error("workout_blocks insert returned no row");

      for (const [mi, mv] of (block.movements ?? []).entries()) {
        const { movement, created } = await resolveMovement(tx as unknown as Db, mv.name, {
          category: mv.category,
          primaryMuscles: mv.primaryMuscles,
        });
        if (created) createdMovements.push(movement.name);

        const bmRows = await tx
          .insert(blockMovements)
          .values({
            userId: ctx.userId,
            blockId: b.id,
            movementId: movement.id,
            seq: mi,
            prescription: mv.prescription,
            repsPerRound: mv.repsPerRound,
            loadKg: mv.load ? toKg(mv.load) : undefined,
            distanceMPerRound: mv.distancePerRound ? toMeters(mv.distancePerRound) : undefined,
          })
          .returning();
        const bm = bmRows[0];
        if (!bm) throw new Error("block_movements insert returned no row");

        for (const [si, set] of (mv.sets ?? []).entries()) {
          await tx.insert(strengthSets).values({
            userId: ctx.userId,
            blockMovementId: bm.id,
            setNumber: si + 1,
            reps: set.reps,
            loadKg: set.load ? toKg(set.load) : undefined,
            rpe: set.rpe,
            isWarmup: set.isWarmup ?? false,
            isFailure: set.isFailure ?? false,
            notes: set.notes,
          });
        }
      }
    }
    return s;
  });

  return {
    status: "logged",
    workout: {
      session,
      blockCount: input.blocks.length,
      movementNames: [...new Set(inputMovementNames)],
      createdMovements,
    },
  };
}

async function findDuplicateCandidates(
  db: Db,
  ctx: UserCtx,
  localDate: string,
  movementNames: string[],
  blockTypes: string[],
): Promise<DuplicateCandidate[]> {
  const sameDay = await db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, ctx.userId), eq(workoutSessions.localDate, localDate)));
  if (sameDay.length === 0) return [];

  const candidates: DuplicateCandidate[] = [];
  for (const s of sameDay) {
    const detail = await sessionDetail(db, s.id);
    const sharedMovements = detail.movementNames.filter((n) => movementNames.includes(n));
    const overlap =
      movementNames.length > 0
        ? sharedMovements.length / Math.max(movementNames.length, 1) >= 0.5
        : blockTypes.join(",") === [...new Set(detail.blockTypes)].sort().join(",");
    if (overlap) {
      candidates.push({
        sessionId: s.id,
        title: s.title,
        startedAt: s.startedAt,
        blockTypes: detail.blockTypes,
        movementNames: detail.movementNames,
      });
    }
  }
  return candidates;
}

async function sessionDetail(
  db: Db,
  sessionId: string,
): Promise<{ blockTypes: string[]; movementNames: string[] }> {
  const blocks = await db
    .select()
    .from(workoutBlocks)
    .where(eq(workoutBlocks.sessionId, sessionId));
  const blockIds = blocks.map((b) => b.id);
  let movementNames: string[] = [];
  if (blockIds.length > 0) {
    const bms = await db
      .select({ name: movements.name })
      .from(blockMovements)
      .innerJoin(movements, eq(blockMovements.movementId, movements.id))
      .where(inArray(blockMovements.blockId, blockIds));
    movementNames = [...new Set(bms.map((r) => r.name))];
  }
  return { blockTypes: blocks.map((b) => b.blockType), movementNames };
}

export interface RecentWorkout {
  session: WorkoutSession;
  blockTypes: string[];
  movementNames: string[];
  muscleGroups: string[];
}

/** Sessions in the trailing `days` window, newest first, with muscle groups. */
export async function getRecentWorkouts(
  db: Db,
  ctx: UserCtx,
  days = 10,
  now: Date = new Date(),
): Promise<RecentWorkout[]> {
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const sinceDate = localDateOf(since, ctx.timezone);
  const sessions = await db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, ctx.userId), gte(workoutSessions.localDate, sinceDate)))
    .orderBy(desc(workoutSessions.startedAt));

  const result: RecentWorkout[] = [];
  for (const s of sessions) {
    const blocks = await db
      .select()
      .from(workoutBlocks)
      .where(eq(workoutBlocks.sessionId, s.id));
    const blockIds = blocks.map((b) => b.id);
    let movementNames: string[] = [];
    let muscleGroups: string[] = [];
    if (blockIds.length > 0) {
      const rows = await db
        .select({ name: movements.name, primaryMuscles: movements.primaryMuscles })
        .from(blockMovements)
        .innerJoin(movements, eq(blockMovements.movementId, movements.id))
        .where(inArray(blockMovements.blockId, blockIds));
      movementNames = [...new Set(rows.map((r) => r.name))];
      muscleGroups = [...new Set(rows.flatMap((r) => r.primaryMuscles))];
    }
    result.push({
      session: s,
      blockTypes: [...new Set(blocks.map((b) => b.blockType))],
      movementNames,
      muscleGroups,
    });
  }
  return result;
}

/**
 * Aggregate working-set volume per muscle group over the trailing window —
 * the core input to "what should I train today?".
 */
export async function muscleGroupVolume(
  db: Db,
  ctx: UserCtx,
  days = 7,
  now: Date = new Date(),
): Promise<Record<string, number>> {
  const recent = await getRecentWorkouts(db, ctx, days, now);
  const volume: Record<string, number> = {};
  for (const w of recent) {
    const blocks = await db
      .select()
      .from(workoutBlocks)
      .where(eq(workoutBlocks.sessionId, w.session.id));
    const blockIds = blocks.map((b) => b.id);
    if (blockIds.length === 0) continue;
    const rows = await db
      .select({
        bmId: blockMovements.id,
        primaryMuscles: movements.primaryMuscles,
      })
      .from(blockMovements)
      .innerJoin(movements, eq(blockMovements.movementId, movements.id))
      .where(inArray(blockMovements.blockId, blockIds));
    for (const row of rows) {
      const sets = await db
        .select()
        .from(strengthSets)
        .where(eq(strengthSets.blockMovementId, row.bmId));
      const workingSets = sets.filter((s) => !s.isWarmup).length || 1; // metcon movements count once
      for (const muscle of row.primaryMuscles) {
        volume[muscle] = (volume[muscle] ?? 0) + workingSets;
      }
    }
  }
  return volume;
}
