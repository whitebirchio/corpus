/**
 * Training plans (specs/04-training-plans/SPEC.md): goal milestones, the
 * one-week rolling plan of prescribed sessions, agent-mediated planned↔actual
 * linking, and the append-only change log. All mutations of a non-empty plan
 * record a plan_changes row in the same transaction (SPEC 04 decision #7).
 */
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Db, UserCtx } from "../db/client.js";
import {
  goalMilestones,
  goals,
  movements,
  planChanges,
  plannedBlockMovements,
  plannedBlocks,
  plannedSessions,
  trainingWeeks,
  workoutSessions,
} from "../db/schema.js";
import type {
  LinkWorkoutToPlanInput,
  PlanWeekInput,
  PlannedSessionInput,
  UpdateMilestoneStatusInput,
  UpdatePlannedSessionInput,
  UpsertMilestoneInput,
} from "../schemas/training.js";
import { addDays, mondayOf, todayIn } from "../time.js";
import { toKg, toMeters, toSeconds, toSecondsPerKm } from "../units.js";
import { resolveMovement } from "./movements.js";

export type GoalMilestone = typeof goalMilestones.$inferSelect;
export type TrainingWeek = typeof trainingWeeks.$inferSelect;
export type PlannedSession = typeof plannedSessions.$inferSelect;
export type PlanChange = typeof planChanges.$inferSelect;

type PlannedBlockInputs = PlannedSessionInput["blocks"];

// --- milestones (§3.1) -------------------------------------------------------

export async function upsertMilestone(
  db: Db,
  ctx: UserCtx,
  input: UpsertMilestoneInput,
): Promise<GoalMilestone> {
  const goalRows = await db
    .select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.id, input.goalId), eq(goals.userId, ctx.userId)));
  if (!goalRows[0]) throw new Error(`Goal ${input.goalId} not found`);

  const values = {
    goalId: input.goalId,
    title: input.title,
    description: input.description,
    target: input.target,
    targetDate: input.targetDate,
    notes: input.notes,
  };

  if (input.id) {
    const rows = await db
      .update(goalMilestones)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(goalMilestones.id, input.id), eq(goalMilestones.userId, ctx.userId)))
      .returning();
    const m = rows[0];
    if (!m) throw new Error(`Milestone ${input.id} not found`);
    return m;
  }

  // No id: match an existing milestone of the same goal by title
  // (case-insensitive) to stay idempotent — same pattern as upsertGoal.
  const existing = await db
    .select()
    .from(goalMilestones)
    .where(
      and(
        eq(goalMilestones.userId, ctx.userId),
        eq(goalMilestones.goalId, input.goalId),
        sql`lower(${goalMilestones.title}) = ${input.title.toLowerCase()}`,
      ),
    );
  const match = existing[0];
  if (match) {
    const rows = await db
      .update(goalMilestones)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(goalMilestones.id, match.id))
      .returning();
    const m = rows[0];
    if (!m) throw new Error("goal_milestones update returned no row");
    return m;
  }

  const rows = await db
    .insert(goalMilestones)
    .values({ userId: ctx.userId, ...values })
    .returning();
  const m = rows[0];
  if (!m) throw new Error("goal_milestones insert returned no row");
  return m;
}

export async function updateMilestoneStatus(
  db: Db,
  ctx: UserCtx,
  input: UpdateMilestoneStatusInput,
): Promise<GoalMilestone> {
  const rows = await db
    .update(goalMilestones)
    .set({
      status: input.status,
      statusChangedAt: new Date(),
      notes: input.notes,
      updatedAt: new Date(),
    })
    .where(and(eq(goalMilestones.id, input.id), eq(goalMilestones.userId, ctx.userId)))
    .returning();
  const m = rows[0];
  if (!m) throw new Error(`Milestone ${input.id} not found`);
  return m;
}

/** Milestones ordered by target date (soonest first, undated last). */
export async function getMilestones(
  db: Db,
  ctx: UserCtx,
  opts?: { goalId?: string; status?: "active" | "paused" | "achieved" | "abandoned" },
): Promise<GoalMilestone[]> {
  const conditions = [eq(goalMilestones.userId, ctx.userId)];
  if (opts?.goalId) conditions.push(eq(goalMilestones.goalId, opts.goalId));
  if (opts?.status) conditions.push(eq(goalMilestones.status, opts.status));
  return db
    .select()
    .from(goalMilestones)
    .where(and(...conditions))
    .orderBy(asc(goalMilestones.targetDate), asc(goalMilestones.createdAt));
}

// --- the weekly plan (§3.2) ----------------------------------------------------

/** Digest of an existing planned session, echoed in refusal results. */
export interface PlannedSessionDigest {
  id: string;
  plannedDate: string;
  title: string;
  status: string;
}

export type PlanWeekResult =
  | {
      status: "planned";
      week: TrainingWeek;
      sessionsPlanned: number;
      /** Non-`planned` sessions from a re-plan, left untouched (decision #11). */
      keptSessions: PlannedSessionDigest[];
      createdMovements: string[];
    }
  | { status: "invalid_dates"; problems: string[] }
  | { status: "change_required"; existingSessions: PlannedSessionDigest[] };

const digest = (s: PlannedSession): PlannedSessionDigest => ({
  id: s.id,
  plannedDate: s.plannedDate,
  title: s.title,
  status: s.status,
});

/** Insert a session's blocks + movements (canonical units, catalog-resolved). */
async function insertPlannedBlocks(
  tx: Db,
  ctx: UserCtx,
  plannedSessionId: string,
  blocks: PlannedBlockInputs,
  createdMovements: string[],
): Promise<void> {
  for (const [bi, block] of blocks.entries()) {
    const targetDistanceM = block.targetDistance ? toMeters(block.targetDistance) : undefined;
    const targetDurationS = block.targetDuration
      ? Math.round(toSeconds(block.targetDuration))
      : undefined;
    let targetPaceSPerKm = block.targetPace ? toSecondsPerKm(block.targetPace) : undefined;
    if (targetPaceSPerKm === undefined && targetDistanceM && targetDurationS && targetDistanceM > 0) {
      targetPaceSPerKm = targetDurationS / (targetDistanceM / 1000);
    }

    const blockRows = await tx
      .insert(plannedBlocks)
      .values({
        userId: ctx.userId,
        plannedSessionId,
        seq: bi,
        blockType: block.type,
        scheme: block.scheme,
        roundsPlanned: block.roundsPlanned,
        timeCapS: block.timeCap ? Math.round(toSeconds(block.timeCap)) : undefined,
        intervalS: block.interval ? Math.round(toSeconds(block.interval)) : undefined,
        targetDistanceM,
        targetDurationS,
        targetPaceSPerKm,
        structure: block.structure,
        targetRpe: block.targetRpe !== undefined ? Math.round(block.targetRpe) : undefined,
        notes: block.notes,
      })
      .returning();
    const b = blockRows[0];
    if (!b) throw new Error("planned_blocks insert returned no row");

    for (const [mi, mv] of (block.movements ?? []).entries()) {
      const { movement, created } = await resolveMovement(tx, mv.name, {
        category: mv.category,
        primaryMuscles: mv.primaryMuscles,
      });
      if (created) createdMovements.push(movement.name);

      await tx.insert(plannedBlockMovements).values({
        userId: ctx.userId,
        plannedBlockId: b.id,
        movementId: movement.id,
        seq: mi,
        sets: mv.sets,
        reps: mv.reps,
        repsText: mv.repsText,
        targetLoadKg: mv.targetLoad ? toKg(mv.targetLoad) : undefined,
        targetRpe: mv.targetRpe !== undefined ? Math.round(mv.targetRpe) : undefined,
        restS: mv.rest ? Math.round(toSeconds(mv.rest)) : undefined,
        prescription: mv.prescription,
        notes: mv.notes,
      });
    }
  }
}

/**
 * Create or re-plan a calendar week (natural key user_id + week_start,
 * SPEC 04 decision #4). Re-planning replaces only `planned`-status sessions;
 * completed/skipped/cancelled rows and their links are never clobbered
 * (decision #11), and requires a change note (decision #7).
 */
export async function planWeek(db: Db, ctx: UserCtx, input: PlanWeekInput): Promise<PlanWeekResult> {
  const problems: string[] = [];
  if (mondayOf(input.weekStart) !== input.weekStart) {
    problems.push(`weekStart ${input.weekStart} is not a Monday`);
  }
  const weekEnd = addDays(input.weekStart, 6);
  const seen = new Set<string>();
  for (const s of input.sessions) {
    if (s.date < input.weekStart || s.date > weekEnd) {
      problems.push(`session "${s.title}" on ${s.date} falls outside ${input.weekStart}..${weekEnd}`);
    }
    if (seen.has(s.date)) {
      problems.push(`more than one session on ${s.date} — one planned session per day`);
    }
    seen.add(s.date);
  }
  if (problems.length > 0) return { status: "invalid_dates", problems };

  const existingWeek = (
    await db
      .select()
      .from(trainingWeeks)
      .where(and(eq(trainingWeeks.userId, ctx.userId), eq(trainingWeeks.weekStart, input.weekStart)))
  )[0];
  const existingSessions = existingWeek
    ? await db
        .select()
        .from(plannedSessions)
        .where(and(eq(plannedSessions.userId, ctx.userId), eq(plannedSessions.weekId, existingWeek.id)))
        .orderBy(asc(plannedSessions.plannedDate))
    : [];

  if (existingSessions.length > 0 && !input.change) {
    return { status: "change_required", existingSessions: existingSessions.map(digest) };
  }

  // Days already holding a completed/skipped/cancelled session stay theirs.
  const kept = existingSessions.filter((s) => s.status !== "planned");
  const keptByDate = new Map(kept.map((s) => [s.plannedDate, s]));
  for (const s of input.sessions) {
    const holder = keptByDate.get(s.date);
    if (holder) {
      problems.push(
        `${s.date} already has a ${holder.status} session ("${holder.title}") — pick another day or leave it`,
      );
    }
  }
  if (problems.length > 0) return { status: "invalid_dates", problems };

  const createdMovements: string[] = [];
  const week = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    const weekRows = await tx
      .insert(trainingWeeks)
      .values({
        userId: ctx.userId,
        weekStart: input.weekStart,
        focus: input.focus,
        notes: input.notes,
      })
      .onConflictDoUpdate({
        target: [trainingWeeks.userId, trainingWeeks.weekStart],
        set: { focus: input.focus, notes: input.notes, updatedAt: new Date() },
      })
      .returning();
    const w = weekRows[0];
    if (!w) throw new Error("training_weeks upsert returned no row");

    await tx
      .delete(plannedSessions)
      .where(
        and(
          eq(plannedSessions.userId, ctx.userId),
          eq(plannedSessions.weekId, w.id),
          eq(plannedSessions.status, "planned"),
        ),
      );

    for (const session of input.sessions) {
      const sessionRows = await tx
        .insert(plannedSessions)
        .values({
          userId: ctx.userId,
          weekId: w.id,
          plannedDate: session.date,
          title: session.title,
          notes: session.notes,
        })
        .returning();
      const s = sessionRows[0];
      if (!s) throw new Error("planned_sessions insert returned no row");
      await insertPlannedBlocks(tx, ctx, s.id, session.blocks, createdMovements);
    }

    if (existingSessions.length > 0 && input.change) {
      await tx.insert(planChanges).values({
        userId: ctx.userId,
        weekId: w.id,
        category: input.change.category,
        summary: input.change.summary,
      });
    }
    return w;
  });

  return {
    status: "planned",
    week,
    sessionsPlanned: input.sessions.length,
    keptSessions: kept.map(digest),
    createdMovements: [...new Set(createdMovements)],
  };
}

export type UpdatePlannedSessionResult =
  | { status: "updated"; session: PlannedSession; createdMovements: string[] }
  | { status: "not_found" }
  | { status: "not_editable"; currentStatus: string }
  | { status: "invalid_dates"; problems: string[] };

/**
 * Surgical mid-week change: move, retitle, re-prescribe (blocks replace),
 * or set status (back to `planned` undoes a mistaken skip/cancel). Completed
 * sessions are refused — unlink the workout first. Always records the change
 * in the same transaction.
 */
export async function updatePlannedSession(
  db: Db,
  ctx: UserCtx,
  input: UpdatePlannedSessionInput,
): Promise<UpdatePlannedSessionResult> {
  const existing = (
    await db
      .select()
      .from(plannedSessions)
      .where(
        and(eq(plannedSessions.id, input.plannedSessionId), eq(plannedSessions.userId, ctx.userId)),
      )
  )[0];
  if (!existing) return { status: "not_found" };
  if (existing.status === "completed") {
    return { status: "not_editable", currentStatus: existing.status };
  }

  if (input.date !== undefined && input.date !== existing.plannedDate) {
    const week = (
      await db
        .select()
        .from(trainingWeeks)
        .where(and(eq(trainingWeeks.id, existing.weekId), eq(trainingWeeks.userId, ctx.userId)))
    )[0];
    if (!week) return { status: "not_found" };
    const problems: string[] = [];
    const weekEnd = addDays(week.weekStart, 6);
    if (input.date < week.weekStart || input.date > weekEnd) {
      problems.push(`${input.date} falls outside the plan week ${week.weekStart}..${weekEnd}`);
    }
    const occupied = (
      await db
        .select({ id: plannedSessions.id })
        .from(plannedSessions)
        .where(
          and(
            eq(plannedSessions.userId, ctx.userId),
            eq(plannedSessions.plannedDate, input.date),
            ne(plannedSessions.id, existing.id),
          ),
        )
    )[0];
    if (occupied) problems.push(`${input.date} already has a planned session`);
    if (problems.length > 0) return { status: "invalid_dates", problems };
  }

  const createdMovements: string[] = [];
  const session = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    const patch: Partial<typeof plannedSessions.$inferInsert> = { updatedAt: new Date() };
    if (input.date !== undefined) patch.plannedDate = input.date;
    if (input.title !== undefined) patch.title = input.title;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.status !== undefined && input.status !== existing.status) {
      patch.status = input.status;
      patch.statusChangedAt = new Date();
    }

    const rows = await tx
      .update(plannedSessions)
      .set(patch)
      .where(eq(plannedSessions.id, existing.id))
      .returning();
    const s = rows[0];
    if (!s) throw new Error("planned_sessions update returned no row");

    if (input.blocks) {
      await tx.delete(plannedBlocks).where(eq(plannedBlocks.plannedSessionId, s.id));
      await insertPlannedBlocks(tx, ctx, s.id, input.blocks, createdMovements);
    }

    await tx.insert(planChanges).values({
      userId: ctx.userId,
      weekId: existing.weekId,
      plannedSessionId: existing.id,
      category: input.change.category,
      summary: input.change.summary,
    });
    return s;
  });

  return { status: "updated", session, createdMovements: [...new Set(createdMovements)] };
}

// --- planned ↔ actual linking (§4.1, decision #6) ------------------------------

export type LinkWorkoutToPlanResult =
  | { status: "linked"; sessionId: string; plannedSessionId: string }
  | { status: "unlinked"; sessionId: string; plannedSessionId: string | null }
  | { status: "not_found"; what: "workout" | "planned_session" }
  | { status: "invalid"; message: string };

/**
 * If no other logged workout still points at the planned session, put it back
 * to `planned` (link removal shouldn't strand a phantom "completed").
 */
async function revertIfOrphaned(tx: Db, ctx: UserCtx, plannedSessionId: string): Promise<void> {
  const stillLinked = (
    await tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, ctx.userId),
          eq(workoutSessions.plannedSessionId, plannedSessionId),
        ),
      )
  )[0];
  if (!stillLinked) {
    await tx
      .update(plannedSessions)
      .set({ status: "planned", statusChangedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(plannedSessions.id, plannedSessionId),
          eq(plannedSessions.userId, ctx.userId),
          eq(plannedSessions.status, "completed"),
        ),
      );
  }
}

/**
 * Agent-mediated reconciliation: link a logged workout to a planned session
 * (marking it completed) or unlink. Idempotent — re-linking the same pair is
 * a no-op success.
 */
export async function linkWorkoutToPlan(
  db: Db,
  ctx: UserCtx,
  input: LinkWorkoutToPlanInput,
): Promise<LinkWorkoutToPlanResult> {
  const workout = (
    await db
      .select({ id: workoutSessions.id, plannedSessionId: workoutSessions.plannedSessionId })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, input.sessionId), eq(workoutSessions.userId, ctx.userId)))
  )[0];
  if (!workout) return { status: "not_found", what: "workout" };

  if (input.unlink) {
    const previous = workout.plannedSessionId;
    if (previous) {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as Db;
        await tx
          .update(workoutSessions)
          .set({ plannedSessionId: null, updatedAt: new Date() })
          .where(eq(workoutSessions.id, workout.id));
        await revertIfOrphaned(tx, ctx, previous);
      });
    }
    return { status: "unlinked", sessionId: workout.id, plannedSessionId: previous };
  }

  if (!input.plannedSessionId) {
    return { status: "invalid", message: "plannedSessionId is required unless unlink is true" };
  }
  const planned = (
    await db
      .select()
      .from(plannedSessions)
      .where(
        and(eq(plannedSessions.id, input.plannedSessionId), eq(plannedSessions.userId, ctx.userId)),
      )
  )[0];
  if (!planned) return { status: "not_found", what: "planned_session" };

  await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as Db;
    const previous = workout.plannedSessionId;
    await tx
      .update(workoutSessions)
      .set({ plannedSessionId: planned.id, updatedAt: new Date() })
      .where(eq(workoutSessions.id, workout.id));
    if (planned.status !== "completed") {
      await tx
        .update(plannedSessions)
        .set({ status: "completed", statusChangedAt: new Date(), updatedAt: new Date() })
        .where(eq(plannedSessions.id, planned.id));
    }
    // Re-linking to a different planned session shouldn't strand the old one.
    if (previous && previous !== planned.id) await revertIfOrphaned(tx, ctx, previous);
  });

  return { status: "linked", sessionId: workout.id, plannedSessionId: planned.id };
}

// --- reads (§4.2) ---------------------------------------------------------------

export interface PlannedMovementDetail {
  name: string;
  sets: number | null;
  reps: number | null;
  repsText: string | null;
  targetLoadKg: number | null;
  targetRpe: number | null;
  restS: number | null;
  prescription: string | null;
  notes: string | null;
}

export interface PlannedBlockDetail {
  seq: number;
  blockType: string;
  scheme: string | null;
  roundsPlanned: number | null;
  timeCapS: number | null;
  intervalS: number | null;
  targetDistanceM: number | null;
  targetDurationS: number | null;
  targetPaceSPerKm: number | null;
  structure: string | null;
  targetRpe: number | null;
  notes: string | null;
  movements: PlannedMovementDetail[];
}

export interface LinkedWorkoutSummary {
  sessionId: string;
  title: string | null;
  startedAt: Date;
  durationS: number | null;
}

export interface PlannedSessionDetail {
  id: string;
  plannedDate: string;
  title: string;
  status: string;
  notes: string | null;
  blocks: PlannedBlockDetail[];
  linkedWorkouts: LinkedWorkoutSummary[];
}

export interface TrainingPlanResult {
  weekStart: string;
  week: TrainingWeek | null;
  sessions: PlannedSessionDetail[];
  changes: PlanChange[];
}

/**
 * The week's plan with full prescriptions, per-session status, linked actuals,
 * and the change log. Quantities stay canonical (kg/m/s); adapters convert for
 * display. A non-Monday `weekStart` is normalized to its week's Monday.
 */
export async function getTrainingPlan(
  db: Db,
  ctx: UserCtx,
  weekStart?: string,
  now: Date = new Date(),
): Promise<TrainingPlanResult> {
  const resolvedStart = mondayOf(weekStart ?? todayIn(ctx.timezone, now));

  const week = (
    await db
      .select()
      .from(trainingWeeks)
      .where(and(eq(trainingWeeks.userId, ctx.userId), eq(trainingWeeks.weekStart, resolvedStart)))
  )[0];
  if (!week) return { weekStart: resolvedStart, week: null, sessions: [], changes: [] };

  const sessions = await db
    .select()
    .from(plannedSessions)
    .where(and(eq(plannedSessions.userId, ctx.userId), eq(plannedSessions.weekId, week.id)))
    .orderBy(asc(plannedSessions.plannedDate));

  const details: PlannedSessionDetail[] = [];
  for (const s of sessions) {
    const blocks = await db
      .select()
      .from(plannedBlocks)
      .where(eq(plannedBlocks.plannedSessionId, s.id))
      .orderBy(asc(plannedBlocks.seq));

    const blockDetails: PlannedBlockDetail[] = [];
    for (const b of blocks) {
      const mvs = await db
        .select({
          name: movements.name,
          sets: plannedBlockMovements.sets,
          reps: plannedBlockMovements.reps,
          repsText: plannedBlockMovements.repsText,
          targetLoadKg: plannedBlockMovements.targetLoadKg,
          targetRpe: plannedBlockMovements.targetRpe,
          restS: plannedBlockMovements.restS,
          prescription: plannedBlockMovements.prescription,
          notes: plannedBlockMovements.notes,
        })
        .from(plannedBlockMovements)
        .innerJoin(movements, eq(plannedBlockMovements.movementId, movements.id))
        .where(eq(plannedBlockMovements.plannedBlockId, b.id))
        .orderBy(asc(plannedBlockMovements.seq));

      blockDetails.push({
        seq: b.seq,
        blockType: b.blockType,
        scheme: b.scheme ?? null,
        roundsPlanned: b.roundsPlanned ?? null,
        timeCapS: b.timeCapS ?? null,
        intervalS: b.intervalS ?? null,
        targetDistanceM: b.targetDistanceM ?? null,
        targetDurationS: b.targetDurationS ?? null,
        targetPaceSPerKm: b.targetPaceSPerKm ?? null,
        structure: b.structure ?? null,
        targetRpe: b.targetRpe ?? null,
        notes: b.notes ?? null,
        movements: mvs.map((m) => ({
          name: m.name,
          sets: m.sets ?? null,
          reps: m.reps ?? null,
          repsText: m.repsText ?? null,
          targetLoadKg: m.targetLoadKg ?? null,
          targetRpe: m.targetRpe ?? null,
          restS: m.restS ?? null,
          prescription: m.prescription ?? null,
          notes: m.notes ?? null,
        })),
      });
    }

    const linked = await db
      .select({
        sessionId: workoutSessions.id,
        title: workoutSessions.title,
        startedAt: workoutSessions.startedAt,
        durationS: workoutSessions.durationS,
      })
      .from(workoutSessions)
      .where(
        and(eq(workoutSessions.userId, ctx.userId), eq(workoutSessions.plannedSessionId, s.id)),
      )
      .orderBy(asc(workoutSessions.startedAt));

    details.push({
      id: s.id,
      plannedDate: s.plannedDate,
      title: s.title,
      status: s.status,
      notes: s.notes ?? null,
      blocks: blockDetails,
      linkedWorkouts: linked,
    });
  }

  const changes = await db
    .select()
    .from(planChanges)
    .where(and(eq(planChanges.userId, ctx.userId), eq(planChanges.weekId, week.id)))
    .orderBy(asc(planChanges.createdAt));

  return { weekStart: resolvedStart, week, sessions: details, changes };
}
