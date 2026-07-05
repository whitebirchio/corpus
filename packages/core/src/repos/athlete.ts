/**
 * The athlete model (specs/04-training-plans/SPEC.md §3.4): equipment on hand,
 * capability estimates (the agent's current beliefs with provenance), and
 * standing planning constraints. Structured where computable; fuzzy learnings
 * stay in insights (decision #8). getTrainingProfile aggregates it all for
 * context-priming at planning time.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db, UserCtx } from "../db/client.js";
import {
  capabilityEstimates,
  equipmentItems,
  goalMilestones,
  goals,
  movements,
  planningConstraints,
  trainingWeeks,
  users,
} from "../db/schema.js";
import type {
  UpsertCapabilityEstimateInput,
  UpsertEquipmentItemInput,
  UpsertPlanningConstraintInput,
} from "../schemas/training.js";
import { mondayOf, todayIn } from "../time.js";
import { toKg, toMeters, toSeconds, toSecondsPerKm } from "../units.js";
import { resolveMovement } from "./movements.js";

export type EquipmentItem = typeof equipmentItems.$inferSelect;
export type CapabilityEstimate = typeof capabilityEstimates.$inferSelect;
export type PlanningConstraint = typeof planningConstraints.$inferSelect;

// --- equipment -----------------------------------------------------------------

export async function upsertEquipmentItem(
  db: Db,
  ctx: UserCtx,
  input: UpsertEquipmentItemInput,
): Promise<EquipmentItem> {
  const values = {
    name: input.name,
    category: input.category,
    details: input.details,
    location: input.location,
    active: input.active ?? true,
    notes: input.notes,
  };

  if (input.id) {
    const rows = await db
      .update(equipmentItems)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(equipmentItems.id, input.id), eq(equipmentItems.userId, ctx.userId)))
      .returning();
    const item = rows[0];
    if (!item) throw new Error(`Equipment item ${input.id} not found`);
    return item;
  }

  const existing = await db
    .select()
    .from(equipmentItems)
    .where(
      and(
        eq(equipmentItems.userId, ctx.userId),
        sql`lower(${equipmentItems.name}) = ${input.name.toLowerCase()}`,
      ),
    );
  const match = existing[0];
  if (match) {
    const rows = await db
      .update(equipmentItems)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(equipmentItems.id, match.id))
      .returning();
    const item = rows[0];
    if (!item) throw new Error("equipment_items update returned no row");
    return item;
  }

  const rows = await db
    .insert(equipmentItems)
    .values({ userId: ctx.userId, ...values })
    .returning();
  const item = rows[0];
  if (!item) throw new Error("equipment_items insert returned no row");
  return item;
}

// --- capability estimates --------------------------------------------------------

/** Canonicalize a unit-tagged capability value (kg, m, s, s/km, m/week). */
function toCanonicalEstimate(est: { value: number; unit: string }): { value: number; unit: string } {
  switch (est.unit) {
    case "kg":
    case "lb":
      return { value: toKg({ value: est.value, unit: est.unit }), unit: "kg" };
    case "m":
    case "km":
    case "mi":
      return { value: toMeters({ value: est.value, unit: est.unit }), unit: "m" };
    case "min/km":
    case "min/mi":
      return { value: toSecondsPerKm({ value: est.value, unit: est.unit }), unit: "s_per_km" };
    case "s":
    case "min":
    case "h":
      return { value: toSeconds({ value: est.value, unit: est.unit }), unit: "s" };
    case "km/week":
      return { value: est.value * 1000, unit: "m_per_week" };
    case "mi/week":
      return { value: toMeters({ value: est.value, unit: "mi" }), unit: "m_per_week" };
    default:
      throw new Error(`Unsupported capability unit: ${est.unit}`);
  }
}

/**
 * Current-belief upsert on the natural key (user, movement?, metric, repMax?)
 * — SPEC 04 decision #12. Progression history lives in the actuals.
 */
export async function upsertCapabilityEstimate(
  db: Db,
  ctx: UserCtx,
  input: UpsertCapabilityEstimateInput,
): Promise<CapabilityEstimate & { movementName: string | null }> {
  let movementId: string | null = null;
  let movementName: string | null = null;
  if (input.movement) {
    const { movement } = await resolveMovement(db, input.movement);
    movementId = movement.id;
    movementName = movement.name;
  }

  const canonical = toCanonicalEstimate(input.estimate);
  const values = {
    metric: input.metric,
    repMax: input.repMax ?? null,
    value: canonical.value,
    unit: canonical.unit,
    confidence: input.confidence ?? ("medium" as const),
    basis: input.basis,
    effectiveDate: input.effectiveDate ?? todayIn(ctx.timezone),
  };

  const rows = await db
    .insert(capabilityEstimates)
    .values({ userId: ctx.userId, movementId, ...values })
    .onConflictDoUpdate({
      target: [
        capabilityEstimates.userId,
        capabilityEstimates.movementId,
        capabilityEstimates.metric,
        capabilityEstimates.repMax,
      ],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  const estimate = rows[0];
  if (!estimate) throw new Error("capability_estimates upsert returned no row");
  return { ...estimate, movementName };
}

/** All current capability beliefs, movement-keyed first, with names joined. */
export async function getCapabilityEstimates(
  db: Db,
  ctx: UserCtx,
): Promise<Array<CapabilityEstimate & { movementName: string | null }>> {
  const rows = await db
    .select({ estimate: capabilityEstimates, movementName: movements.name })
    .from(capabilityEstimates)
    .leftJoin(movements, eq(capabilityEstimates.movementId, movements.id))
    .where(eq(capabilityEstimates.userId, ctx.userId))
    .orderBy(asc(capabilityEstimates.metric), asc(capabilityEstimates.createdAt));
  return rows.map((r) => ({ ...r.estimate, movementName: r.movementName }));
}

// --- planning constraints ---------------------------------------------------------

export async function upsertPlanningConstraint(
  db: Db,
  ctx: UserCtx,
  input: UpsertPlanningConstraintInput,
): Promise<PlanningConstraint> {
  const values = {
    kind: input.kind,
    rule: input.rule,
    params: input.params,
    active: input.active ?? true,
    notes: input.notes,
  };

  if (input.id) {
    const rows = await db
      .update(planningConstraints)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(planningConstraints.id, input.id), eq(planningConstraints.userId, ctx.userId)))
      .returning();
    const c = rows[0];
    if (!c) throw new Error(`Planning constraint ${input.id} not found`);
    return c;
  }

  const existing = await db
    .select()
    .from(planningConstraints)
    .where(
      and(
        eq(planningConstraints.userId, ctx.userId),
        sql`lower(${planningConstraints.rule}) = ${input.rule.toLowerCase()}`,
      ),
    );
  const match = existing[0];
  if (match) {
    const rows = await db
      .update(planningConstraints)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(planningConstraints.id, match.id))
      .returning();
    const c = rows[0];
    if (!c) throw new Error("planning_constraints update returned no row");
    return c;
  }

  const rows = await db
    .insert(planningConstraints)
    .values({ userId: ctx.userId, ...values })
    .returning();
  const c = rows[0];
  if (!c) throw new Error("planning_constraints insert returned no row");
  return c;
}

// --- the aggregate profile (§4.2) --------------------------------------------------

export interface GoalWithMilestones {
  id: string;
  title: string;
  priority: number;
  targetDate: string | null;
  milestones: Array<{
    id: string;
    title: string;
    target: unknown;
    targetDate: string | null;
    status: string;
  }>;
}

export interface TrainingProfile {
  homeLocation: string | null;
  currentWeek: { weekStart: string; focus: string | null } | null;
  goals: GoalWithMilestones[];
  capabilities: Array<CapabilityEstimate & { movementName: string | null }>;
  equipment: EquipmentItem[];
  constraints: PlanningConstraint[];
}

/**
 * Everything the planner should know about the athlete, in one read:
 * active goals with their active milestones, capability beliefs, active
 * equipment, active constraints, home location, and the current week's focus.
 */
export async function getTrainingProfile(db: Db, ctx: UserCtx): Promise<TrainingProfile> {
  const user = (await db.select().from(users).where(eq(users.id, ctx.userId)))[0];

  const weekStart = mondayOf(todayIn(ctx.timezone));
  const week = (
    await db
      .select()
      .from(trainingWeeks)
      .where(and(eq(trainingWeeks.userId, ctx.userId), eq(trainingWeeks.weekStart, weekStart)))
  )[0];

  const activeGoals = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, ctx.userId), eq(goals.status, "active")))
    .orderBy(asc(goals.priority), asc(goals.createdAt));
  const activeMilestones = await db
    .select()
    .from(goalMilestones)
    .where(and(eq(goalMilestones.userId, ctx.userId), eq(goalMilestones.status, "active")))
    .orderBy(asc(goalMilestones.targetDate), asc(goalMilestones.createdAt));

  const equipment = await db
    .select()
    .from(equipmentItems)
    .where(and(eq(equipmentItems.userId, ctx.userId), eq(equipmentItems.active, true)))
    .orderBy(asc(equipmentItems.category), asc(equipmentItems.name));

  const constraints = await db
    .select()
    .from(planningConstraints)
    .where(and(eq(planningConstraints.userId, ctx.userId), eq(planningConstraints.active, true)))
    .orderBy(asc(planningConstraints.kind), asc(planningConstraints.createdAt));

  return {
    homeLocation: user?.homeLocation ?? null,
    currentWeek: week ? { weekStart: week.weekStart, focus: week.focus ?? null } : null,
    goals: activeGoals.map((g) => ({
      id: g.id,
      title: g.title,
      priority: g.priority,
      targetDate: g.targetDate ?? null,
      milestones: activeMilestones
        .filter((m) => m.goalId === g.id)
        .map((m) => ({
          id: m.id,
          title: m.title,
          target: m.target,
          targetDate: m.targetDate ?? null,
          status: m.status,
        })),
    })),
    capabilities: await getCapabilityEstimates(db, ctx),
    equipment,
    constraints,
  };
}
