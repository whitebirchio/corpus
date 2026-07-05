import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db, UserCtx } from "../src/db/client.js";
import { planChanges, plannedSessions } from "../src/db/schema.js";
import {
  getTrainingPlan,
  linkWorkoutToPlan,
  planWeek,
  updatePlannedSession,
} from "../src/repos/training.js";
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

// 2026-07-06 is a Monday.
const WEEK = "2026-07-06";

const sampleWeek = () => ({
  weekStart: WEEK,
  focus: "aerobic base + maintain strength",
  sessions: [
    {
      date: "2026-07-07",
      title: "Lower strength",
      blocks: [
        {
          type: "strength" as const,
          movements: [
            {
              name: "back squat",
              sets: 4,
              reps: 8,
              targetLoad: { value: 135, unit: "lb" as const },
              targetRpe: 7,
              prescription: "4×8 @ 135 lb",
            },
            { name: "romanian deadlift", sets: 3, reps: 10, targetLoad: { value: 95, unit: "lb" as const } },
          ],
        },
      ],
    },
    {
      date: "2026-07-09",
      title: "Zone 2 run",
      blocks: [
        {
          type: "run" as const,
          targetDistance: { value: 4, unit: "mi" as const },
          targetRpe: 4,
          structure: "easy conversational pace",
        },
      ],
    },
    {
      date: "2026-07-11",
      title: "Long run",
      blocks: [
        {
          type: "run" as const,
          targetDistance: { value: 8, unit: "mi" as const },
          targetDuration: { value: 90, unit: "min" as const },
        },
      ],
    },
  ],
});

describe("planWeek", () => {
  it("creates the nested week with canonical units", async () => {
    const result = await planWeek(db, ctx, sampleWeek());
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.sessionsPlanned).toBe(3);
    expect(result.createdMovements).toEqual([]);

    const plan = await getTrainingPlan(db, ctx, WEEK);
    expect(plan.week?.focus).toBe("aerobic base + maintain strength");
    expect(plan.sessions).toHaveLength(3);

    const lower = plan.sessions[0]!;
    expect(lower.title).toBe("Lower strength");
    expect(lower.status).toBe("planned");
    const squat = lower.blocks[0]!.movements[0]!;
    expect(squat.name).toBe("back squat");
    expect(squat.targetLoadKg).toBeCloseTo(61.23, 1); // 135 lb → kg

    const longRun = plan.sessions[2]!;
    const runBlock = longRun.blocks[0]!;
    expect(runBlock.targetDistanceM).toBeCloseTo(12874.75, 0); // 8 mi → m
    expect(runBlock.targetDurationS).toBe(5400);
    // pace derived from distance + duration
    expect(runBlock.targetPaceSPerKm).toBeCloseTo(5400 / 12.87475, 0);
  });

  it("rejects a non-Monday weekStart and out-of-window dates", async () => {
    const input = sampleWeek();
    input.weekStart = "2026-07-07"; // Tuesday
    const result = await planWeek(db, ctx, input);
    expect(result.status).toBe("invalid_dates");
    if (result.status !== "invalid_dates") return;
    expect(result.problems.some((p) => p.includes("not a Monday"))).toBe(true);

    const outside = sampleWeek();
    outside.sessions[0]!.date = "2026-07-13"; // following Monday
    const r2 = await planWeek(db, ctx, outside);
    expect(r2.status).toBe("invalid_dates");
  });

  it("rejects two sessions on the same day", async () => {
    const input = sampleWeek();
    input.sessions[1]!.date = input.sessions[0]!.date;
    const result = await planWeek(db, ctx, input);
    expect(result.status).toBe("invalid_dates");
    if (result.status !== "invalid_dates") return;
    expect(result.problems.some((p) => p.includes("one planned session per day"))).toBe(true);
  });

  it("requires a change note to re-plan a non-empty week", async () => {
    await planWeek(db, ctx, sampleWeek());
    const result = await planWeek(db, ctx, sampleWeek());
    expect(result.status).toBe("change_required");
    if (result.status !== "change_required") return;
    expect(result.existingSessions).toHaveLength(3);
  });

  it("re-plans by replacing planned sessions, keeping completed ones, and logging the change", async () => {
    await planWeek(db, ctx, sampleWeek());
    let plan = await getTrainingPlan(db, ctx, WEEK);

    // Complete Tuesday by linking a logged workout to it.
    const logged = await logWorkout(db, ctx, {
      date: "2026-07-07",
      title: "Lower strength",
      allowDuplicate: true,
      blocks: [
        {
          type: "strength",
          movements: [
            { name: "back squat", sets: [{ reps: 8, load: { value: 145, unit: "lb" } }] },
          ],
        },
      ],
    });
    if (logged.status !== "logged") throw new Error("log failed");
    const tuesday = plan.sessions[0]!;
    await linkWorkoutToPlan(db, ctx, {
      sessionId: logged.workout.session.id,
      plannedSessionId: tuesday.id,
    });

    // Re-plan the rest of the week (Tuesday's date left alone).
    const replan = {
      ...sampleWeek(),
      focus: "recovery week",
      sessions: sampleWeek().sessions.slice(1), // drop the (completed) Tuesday slot
      change: { category: "fatigue" as const, summary: "Felt run down; easier week" },
    };
    const result = await planWeek(db, ctx, replan);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.keptSessions).toHaveLength(1);
    expect(result.keptSessions[0]!.status).toBe("completed");

    plan = await getTrainingPlan(db, ctx, WEEK);
    expect(plan.week?.focus).toBe("recovery week");
    expect(plan.sessions).toHaveLength(3); // completed Tuesday + 2 new
    expect(plan.sessions[0]!.status).toBe("completed");
    expect(plan.sessions[0]!.linkedWorkouts).toHaveLength(1);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]!.category).toBe("fatigue");
  });

  it("refuses to plan over a day held by a completed session", async () => {
    await planWeek(db, ctx, sampleWeek());
    const plan = await getTrainingPlan(db, ctx, WEEK);
    const logged = await logWorkout(db, ctx, {
      date: "2026-07-07",
      title: "did it",
      allowDuplicate: true,
      allowIncomplete: true,
      blocks: [{ type: "run", distance: { value: 3, unit: "mi" } }],
    });
    if (logged.status !== "logged") throw new Error("log failed");
    await linkWorkoutToPlan(db, ctx, {
      sessionId: logged.workout.session.id,
      plannedSessionId: plan.sessions[0]!.id,
    });

    const replan = {
      ...sampleWeek(),
      change: { category: "schedule" as const, summary: "reshuffle" },
    };
    const result = await planWeek(db, ctx, replan);
    expect(result.status).toBe("invalid_dates");
    if (result.status !== "invalid_dates") return;
    expect(result.problems.some((p) => p.includes("completed"))).toBe(true);
  });

  it("adds unknown movements to the catalog and reports them", async () => {
    const input = {
      weekStart: WEEK,
      sessions: [
        {
          date: "2026-07-07",
          title: "Quads",
          blocks: [
            {
              type: "strength" as const,
              movements: [
                {
                  name: "reverse nordic curl",
                  category: "squat" as const,
                  primaryMuscles: ["quads"],
                  sets: 3,
                  reps: 8,
                },
              ],
            },
          ],
        },
      ],
    };
    const result = await planWeek(db, ctx, input);
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    expect(result.createdMovements).toEqual(["reverse nordic curl"]);
  });
});

describe("updatePlannedSession", () => {
  it("moves and re-prescribes a session, recording the change", async () => {
    await planWeek(db, ctx, sampleWeek());
    const plan = await getTrainingPlan(db, ctx, WEEK);
    const run = plan.sessions[1]!;

    const result = await updatePlannedSession(db, ctx, {
      plannedSessionId: run.id,
      date: "2026-07-10",
      blocks: [
        {
          type: "run",
          targetDistance: { value: 2, unit: "mi" },
          structure: "short shakeout instead",
        },
      ],
      change: { category: "weather", summary: "Thunderstorms Thursday; moved run to Friday, shortened" },
    });
    expect(result.status).toBe("updated");

    const after = await getTrainingPlan(db, ctx, WEEK);
    const moved = after.sessions.find((s) => s.id === run.id)!;
    expect(moved.plannedDate).toBe("2026-07-10");
    expect(moved.blocks).toHaveLength(1);
    expect(moved.blocks[0]!.targetDistanceM).toBeCloseTo(3218.69, 0);
    expect(after.changes).toHaveLength(1);
    expect(after.changes[0]!.plannedSessionId).toBe(run.id);
  });

  it("skips a session (status + statusChangedAt) and can undo the skip", async () => {
    await planWeek(db, ctx, sampleWeek());
    const plan = await getTrainingPlan(db, ctx, WEEK);
    const target = plan.sessions[0]!;

    const skip = await updatePlannedSession(db, ctx, {
      plannedSessionId: target.id,
      status: "skipped",
      change: { category: "sickness", summary: "Sick, skipped Tuesday lower day" },
    });
    expect(skip.status).toBe("updated");
    if (skip.status !== "updated") return;
    expect(skip.session.status).toBe("skipped");

    const undo = await updatePlannedSession(db, ctx, {
      plannedSessionId: target.id,
      status: "planned",
      change: { category: "other", summary: "Feeling better; back on" },
    });
    expect(undo.status).toBe("updated");
    if (undo.status !== "updated") return;
    expect(undo.session.status).toBe("planned");

    const changes = await db.select().from(planChanges);
    expect(changes).toHaveLength(2);
  });

  it("refuses to edit a completed session and validates date moves", async () => {
    await planWeek(db, ctx, sampleWeek());
    const plan = await getTrainingPlan(db, ctx, WEEK);
    const [tuesday, thursday] = [plan.sessions[0]!, plan.sessions[1]!];

    const logged = await logWorkout(db, ctx, {
      date: "2026-07-07",
      title: "done",
      allowDuplicate: true,
      allowIncomplete: true,
      blocks: [{ type: "run", distance: { value: 1, unit: "mi" } }],
    });
    if (logged.status !== "logged") throw new Error("log failed");
    await linkWorkoutToPlan(db, ctx, {
      sessionId: logged.workout.session.id,
      plannedSessionId: tuesday.id,
    });

    const completedEdit = await updatePlannedSession(db, ctx, {
      plannedSessionId: tuesday.id,
      title: "nope",
      change: { category: "other", summary: "should refuse" },
    });
    expect(completedEdit.status).toBe("not_editable");

    const ontoOccupied = await updatePlannedSession(db, ctx, {
      plannedSessionId: thursday.id,
      date: tuesday.plannedDate,
      change: { category: "schedule", summary: "collide" },
    });
    expect(ontoOccupied.status).toBe("invalid_dates");

    const outOfWeek = await updatePlannedSession(db, ctx, {
      plannedSessionId: thursday.id,
      date: "2026-07-14",
      change: { category: "schedule", summary: "next week" },
    });
    expect(outOfWeek.status).toBe("invalid_dates");

    const missing = await updatePlannedSession(db, ctx, {
      plannedSessionId: "00000000-0000-0000-0000-000000000000",
      change: { category: "other", summary: "ghost" },
    });
    expect(missing.status).toBe("not_found");
  });
});

describe("linkWorkoutToPlan", () => {
  it("links idempotently, unlinks with status revert, and re-links across sessions", async () => {
    await planWeek(db, ctx, sampleWeek());
    const plan = await getTrainingPlan(db, ctx, WEEK);
    const [tuesday, thursday] = [plan.sessions[0]!, plan.sessions[1]!];

    const logged = await logWorkout(db, ctx, {
      date: "2026-07-07",
      title: "Lower strength",
      allowDuplicate: true,
      allowIncomplete: true,
      blocks: [{ type: "strength", movements: [{ name: "back squat", prescription: "4x8" }] }],
    });
    if (logged.status !== "logged") throw new Error("log failed");
    const workoutId = logged.workout.session.id;

    const link = await linkWorkoutToPlan(db, ctx, {
      sessionId: workoutId,
      plannedSessionId: tuesday.id,
    });
    expect(link.status).toBe("linked");
    const again = await linkWorkoutToPlan(db, ctx, {
      sessionId: workoutId,
      plannedSessionId: tuesday.id,
    });
    expect(again.status).toBe("linked");

    // Re-link to Thursday: Tuesday reverts to planned, Thursday completes.
    const relink = await linkWorkoutToPlan(db, ctx, {
      sessionId: workoutId,
      plannedSessionId: thursday.id,
    });
    expect(relink.status).toBe("linked");
    let rows = await db.select().from(plannedSessions).where(eq(plannedSessions.id, tuesday.id));
    expect(rows[0]!.status).toBe("planned");
    rows = await db.select().from(plannedSessions).where(eq(plannedSessions.id, thursday.id));
    expect(rows[0]!.status).toBe("completed");

    const unlink = await linkWorkoutToPlan(db, ctx, { sessionId: workoutId, unlink: true });
    expect(unlink.status).toBe("unlinked");
    rows = await db.select().from(plannedSessions).where(eq(plannedSessions.id, thursday.id));
    expect(rows[0]!.status).toBe("planned");
  });

  it("returns not_found / invalid for bad ids or missing target", async () => {
    await planWeek(db, ctx, sampleWeek());
    const plan = await getTrainingPlan(db, ctx, WEEK);

    const noWorkout = await linkWorkoutToPlan(db, ctx, {
      sessionId: "00000000-0000-0000-0000-000000000000",
      plannedSessionId: plan.sessions[0]!.id,
    });
    expect(noWorkout.status).toBe("not_found");

    const logged = await logWorkout(db, ctx, {
      date: "2026-07-07",
      title: "x",
      allowDuplicate: true,
      allowIncomplete: true,
      blocks: [{ type: "run", distance: { value: 1, unit: "mi" } }],
    });
    if (logged.status !== "logged") throw new Error("log failed");

    const noTarget = await linkWorkoutToPlan(db, ctx, {
      sessionId: logged.workout.session.id,
    });
    expect(noTarget.status).toBe("invalid");

    const otherUser = await createTestUser(db, { email: "other@example.com" });
    const crossUser = await linkWorkoutToPlan(db, otherUser, {
      sessionId: logged.workout.session.id,
      plannedSessionId: plan.sessions[0]!.id,
    });
    expect(crossUser.status).toBe("not_found");
  });
});

describe("getTrainingPlan", () => {
  it("returns an empty shell for an unplanned week and normalizes weekStart", async () => {
    const plan = await getTrainingPlan(db, ctx, "2026-07-08"); // Wednesday
    expect(plan.weekStart).toBe(WEEK);
    expect(plan.week).toBeNull();
    expect(plan.sessions).toEqual([]);
    expect(plan.changes).toEqual([]);
  });
});
