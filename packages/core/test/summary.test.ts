import { beforeEach, describe, expect, it } from "vitest";
import type { Db, UserCtx } from "../src/db/client.js";
import { upsertGoal } from "../src/repos/goals.js";
import { getDailySummary } from "../src/repos/summary.js";
import { linkWorkoutToPlan, planWeek, upsertMilestone } from "../src/repos/training.js";
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

// 2026-07-06 Monday; 07-07 Tuesday.
const WEEK = "2026-07-06";
const DAY = "2026-07-07";

async function planTuesday() {
  return planWeek(db, ctx, {
    weekStart: WEEK,
    focus: "aerobic base",
    sessions: [
      {
        date: DAY,
        title: "Lower strength",
        blocks: [
          {
            type: "strength",
            movements: [
              { name: "back squat", sets: 4, reps: 8, targetLoad: { value: 135, unit: "lb" } },
            ],
          },
        ],
      },
    ],
  });
}

describe("getDailySummary — plan awareness", () => {
  it("returns null todaysPlan when nothing is planned", async () => {
    const summary = await getDailySummary(db, ctx, DAY);
    expect(summary.todaysPlan).toBeNull();
  });

  it("surfaces today's planned session as a compact digest", async () => {
    await planTuesday();
    const summary = await getDailySummary(db, ctx, DAY);
    expect(summary.todaysPlan).not.toBeNull();
    const plan = summary.todaysPlan!;
    expect(plan.title).toBe("Lower strength");
    expect(plan.status).toBe("planned");
    expect(plan.blockTypes).toEqual(["strength"]);
    expect(plan.movements).toContain("back squat");
    expect(plan.linkedSessionId).toBeNull();
    // A different day in the same week has no session.
    const wed = await getDailySummary(db, ctx, "2026-07-08");
    expect(wed.todaysPlan).toBeNull();
  });

  it("reflects a linked workout: status completed + linkedSessionId set", async () => {
    await planTuesday();
    const before = await getDailySummary(db, ctx, DAY);
    const planned = before.todaysPlan!;

    const logged = await logWorkout(db, ctx, {
      date: DAY,
      title: "Lower strength",
      allowDuplicate: true,
      blocks: [
        { type: "strength", movements: [{ name: "back squat", sets: [{ reps: 8, load: { value: 145, unit: "lb" } }] }] },
      ],
    });
    if (logged.status !== "logged") throw new Error("log failed");
    await linkWorkoutToPlan(db, ctx, {
      sessionId: logged.workout.session.id,
      plannedSessionId: planned.plannedSessionId,
    });

    const after = await getDailySummary(db, ctx, DAY);
    expect(after.todaysPlan!.status).toBe("completed");
    expect(after.todaysPlan!.linkedSessionId).toBe(logged.workout.session.id);
  });
});

describe("getDailySummary — goals carry milestones", () => {
  it("attaches each goal's milestones to the goals digest", async () => {
    const goal = await upsertGoal(db, ctx, { title: "40-mile ultra at 40", domain: "fitness" });
    await upsertMilestone(db, ctx, {
      goalId: goal.id,
      title: "30 mi/week base",
      targetDate: "2026-12-31",
    });

    const summary = await getDailySummary(db, ctx, DAY);
    const g = summary.goals.find((x) => x.id === goal.id);
    expect(g).toBeDefined();
    expect(g!.milestones).toHaveLength(1);
    expect(g!.milestones[0]!.title).toBe("30 mi/week base");
  });
});
