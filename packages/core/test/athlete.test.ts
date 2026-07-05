import { beforeEach, describe, expect, it } from "vitest";
import type { Db, UserCtx } from "../src/db/client.js";
import {
  getCapabilityEstimates,
  getTrainingProfile,
  upsertCapabilityEstimate,
  upsertEquipmentItem,
  upsertPlanningConstraint,
} from "../src/repos/athlete.js";
import { upsertGoal } from "../src/repos/goals.js";
import { planWeek, upsertMilestone } from "../src/repos/training.js";
import { setHomeLocation } from "../src/repos/users.js";
import { seedMovements } from "../src/seed/movements.js";
import { mondayOf, todayIn } from "../src/time.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;

beforeEach(async () => {
  ({ db } = await createTestDb());
  await seedMovements(db);
  ctx = await createTestUser(db);
});

describe("upsertEquipmentItem", () => {
  it("creates, rematches by name case-insensitively, and deactivates", async () => {
    const created = await upsertEquipmentItem(db, ctx, {
      name: "adjustable dumbbells",
      category: "dumbbell",
      details: { maxLoadKg: 40, count: 2 },
      location: "garage",
    });
    expect(created.active).toBe(true);

    const rematched = await upsertEquipmentItem(db, ctx, {
      name: "Adjustable Dumbbells",
      category: "dumbbell",
      details: { maxLoadKg: 50, count: 2 },
    });
    expect(rematched.id).toBe(created.id);
    expect(rematched.details).toEqual({ maxLoadKg: 50, count: 2 });

    const retired = await upsertEquipmentItem(db, ctx, {
      id: created.id,
      name: "adjustable dumbbells",
      category: "dumbbell",
      active: false,
    });
    expect(retired.active).toBe(false);

    const profile = await getTrainingProfile(db, ctx);
    expect(profile.equipment).toHaveLength(0); // inactive items filtered out
  });
});

describe("upsertCapabilityEstimate", () => {
  it("stores canonical units and upserts on the movement-keyed natural key", async () => {
    const first = await upsertCapabilityEstimate(db, ctx, {
      movement: "Back Squat",
      metric: "working_load",
      repMax: 8,
      estimate: { value: 135, unit: "lb" },
      basis: "4×8 @ 135 lb on 2026-07-01, RPE 7",
    });
    expect(first.movementName).toBe("back squat");
    expect(first.unit).toBe("kg");
    expect(first.value).toBeCloseTo(61.23, 1);
    expect(first.confidence).toBe("medium");

    // Same key → belief replaced, not duplicated.
    const updated = await upsertCapabilityEstimate(db, ctx, {
      movement: "back squat",
      metric: "working_load",
      repMax: 8,
      estimate: { value: 145, unit: "lb" },
      confidence: "high",
      basis: "4×8 @ 145 lb on 2026-07-08, RPE 7",
    });
    expect(updated.id).toBe(first.id);
    expect(updated.value).toBeCloseTo(65.77, 1);
    expect(updated.confidence).toBe("high");

    // Different repMax → distinct belief.
    await upsertCapabilityEstimate(db, ctx, {
      movement: "back squat",
      metric: "working_load",
      repMax: 5,
      estimate: { value: 155, unit: "lb" },
      basis: "5×5 @ 155 lb on 2026-07-03",
    });
    expect(await getCapabilityEstimates(db, ctx)).toHaveLength(2);
  });

  it("upserts movement-less metrics (NULL movement, NULL repMax) without duplicating", async () => {
    await upsertCapabilityEstimate(db, ctx, {
      metric: "weekly_run_volume",
      estimate: { value: 18, unit: "mi/week" },
      basis: "4-week average from Garmin, June 2026",
    });
    const updated = await upsertCapabilityEstimate(db, ctx, {
      metric: "weekly_run_volume",
      estimate: { value: 20, unit: "mi/week" },
      basis: "trailing 4 weeks through 2026-07-05",
    });
    expect(updated.unit).toBe("m_per_week");
    expect(updated.value).toBeCloseTo(32186.88, 0);

    const all = await getCapabilityEstimates(db, ctx);
    expect(all).toHaveLength(1);
    expect(all[0]!.movementName).toBeNull();
  });

  it("converts pace estimates to s/km", async () => {
    const pace = await upsertCapabilityEstimate(db, ctx, {
      metric: "zone2_pace",
      estimate: { value: 12.5, unit: "min/mi" },
      basis: "treadmill Z2 sessions, HR 115-125",
    });
    expect(pace.unit).toBe("s_per_km");
    expect(pace.value).toBeCloseTo((12.5 * 60) / 1.609344, 1);
  });
});

describe("upsertPlanningConstraint", () => {
  it("creates, rematches by rule, and deactivates", async () => {
    const created = await upsertPlanningConstraint(db, ctx, {
      kind: "seasonal",
      rule: "No outdoor runs below about -12C — treadmill instead",
    });
    const rematched = await upsertPlanningConstraint(db, ctx, {
      kind: "seasonal",
      rule: "No outdoor runs below about -12C — treadmill instead",
      notes: "confirmed again winter 2026",
    });
    expect(rematched.id).toBe(created.id);

    const retired = await upsertPlanningConstraint(db, ctx, {
      id: created.id,
      kind: "seasonal",
      rule: created.rule,
      active: false,
    });
    expect(retired.active).toBe(false);
  });
});

describe("getTrainingProfile", () => {
  it("aggregates location, week focus, goals+milestones, capabilities, equipment, constraints", async () => {
    await setHomeLocation(db, ctx.userId, "Exeter, NH");

    const goal = await upsertGoal(db, ctx, { title: "40-mile ultra at 40", domain: "fitness" });
    await upsertMilestone(db, ctx, {
      goalId: goal.id,
      title: "30 mi/week base",
      targetDate: "2026-12-31",
    });

    const monday = mondayOf(todayIn(ctx.timezone));
    await planWeek(db, ctx, {
      weekStart: monday,
      focus: "aerobic base",
      sessions: [
        { date: monday, title: "Easy run", blocks: [{ type: "run", targetDistance: { value: 3, unit: "mi" } }] },
      ],
    });

    await upsertEquipmentItem(db, ctx, { name: "barbell", category: "barbell" });
    await upsertPlanningConstraint(db, ctx, { kind: "schedule", rule: "Long run Saturday mornings" });
    await upsertCapabilityEstimate(db, ctx, {
      metric: "weekly_run_volume",
      estimate: { value: 18, unit: "mi/week" },
      basis: "June average",
    });

    const profile = await getTrainingProfile(db, ctx);
    expect(profile.homeLocation).toBe("Exeter, NH");
    expect(profile.currentWeek).toEqual({ weekStart: monday, focus: "aerobic base" });
    expect(profile.goals).toHaveLength(1);
    expect(profile.goals[0]!.milestones).toHaveLength(1);
    expect(profile.capabilities).toHaveLength(1);
    expect(profile.equipment).toHaveLength(1);
    expect(profile.constraints).toHaveLength(1);
  });
});
