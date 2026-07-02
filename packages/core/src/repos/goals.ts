import { and, asc, eq, sql } from "drizzle-orm";
import type { Db, UserCtx } from "../db/client.js";
import { goals, insights, observations } from "../db/schema.js";
import type {
  LogObservationInput,
  SaveInsightInput,
  UpdateGoalStatusInput,
  UpsertGoalInput,
} from "../schemas/inputs.js";
import { todayIn, zonedToUtc } from "../time.js";

export type Goal = typeof goals.$inferSelect;
export type Insight = typeof insights.$inferSelect;
export type Observation = typeof observations.$inferSelect;

export async function upsertGoal(db: Db, ctx: UserCtx, input: UpsertGoalInput): Promise<Goal> {
  const values = {
    title: input.title,
    domain: input.domain,
    description: input.description,
    priority: input.priority ?? 100,
    target: input.target,
    targetDate: input.targetDate,
    notes: input.notes,
  };

  if (input.id) {
    const rows = await db
      .update(goals)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(goals.id, input.id), eq(goals.userId, ctx.userId)))
      .returning();
    const g = rows[0];
    if (!g) throw new Error(`Goal ${input.id} not found`);
    return g;
  }

  // No id: match an existing goal by title (case-insensitive) to stay idempotent.
  const existing = await db
    .select()
    .from(goals)
    .where(
      and(eq(goals.userId, ctx.userId), sql`lower(${goals.title}) = ${input.title.toLowerCase()}`),
    );
  const match = existing[0];
  if (match) {
    const rows = await db
      .update(goals)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(goals.id, match.id))
      .returning();
    const g = rows[0];
    if (!g) throw new Error("goals update returned no row");
    return g;
  }

  const rows = await db
    .insert(goals)
    .values({ userId: ctx.userId, ...values })
    .returning();
  const g = rows[0];
  if (!g) throw new Error("goals insert returned no row");
  return g;
}

export async function updateGoalStatus(
  db: Db,
  ctx: UserCtx,
  input: UpdateGoalStatusInput,
): Promise<Goal> {
  const rows = await db
    .update(goals)
    .set({
      status: input.status,
      statusChangedAt: new Date(),
      notes: input.notes,
      updatedAt: new Date(),
    })
    .where(and(eq(goals.id, input.id), eq(goals.userId, ctx.userId)))
    .returning();
  const g = rows[0];
  if (!g) throw new Error(`Goal ${input.id} not found`);
  return g;
}

export async function getActiveGoals(db: Db, ctx: UserCtx): Promise<Goal[]> {
  return db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, ctx.userId), eq(goals.status, "active")))
    .orderBy(asc(goals.priority), asc(goals.createdAt));
}

export async function saveInsight(db: Db, ctx: UserCtx, input: SaveInsightInput): Promise<Insight> {
  const rows = await db
    .insert(insights)
    .values({
      userId: ctx.userId,
      title: input.title,
      body: input.body,
      tags: input.tags ?? [],
      source: "agent",
    })
    .returning();
  const i = rows[0];
  if (!i) throw new Error("insights insert returned no row");
  return i;
}

export async function archiveInsight(db: Db, ctx: UserCtx, id: string): Promise<Insight> {
  const rows = await db
    .update(insights)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(insights.id, id), eq(insights.userId, ctx.userId)))
    .returning();
  const i = rows[0];
  if (!i) throw new Error(`Insight ${id} not found`);
  return i;
}

export async function getActiveInsights(db: Db, ctx: UserCtx): Promise<Insight[]> {
  return db
    .select()
    .from(insights)
    .where(and(eq(insights.userId, ctx.userId), eq(insights.status, "active")))
    .orderBy(asc(insights.createdAt));
}

export async function logObservation(
  db: Db,
  ctx: UserCtx,
  input: LogObservationInput,
): Promise<Observation> {
  const localDate = input.date ?? todayIn(ctx.timezone);
  const observedAt =
    !input.date && !input.time
      ? new Date()
      : zonedToUtc(localDate, input.time ?? "12:00", ctx.timezone);
  const rows = await db
    .insert(observations)
    .values({
      userId: ctx.userId,
      observedAt,
      localDate,
      kind: input.kind,
      valueNum: input.value,
      bodyArea: input.bodyArea,
      text: input.text,
    })
    .returning();
  const o = rows[0];
  if (!o) throw new Error("observations insert returned no row");
  return o;
}
