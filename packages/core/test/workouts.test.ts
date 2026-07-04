import { beforeEach, describe, expect, it } from "vitest";
import type { Db, UserCtx } from "../src/db/client.js";
import { normalizeMovementName, resolveMovement } from "../src/repos/movements.js";
import {
  getDayWorkouts,
  getMovementHistory,
  getRecentWorkouts,
  getWorkoutDetail,
  logWorkout,
  muscleGroupVolume,
} from "../src/repos/workouts.js";
import { seedMovements } from "../src/seed/movements.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;

beforeEach(async () => {
  ({ db } = await createTestDb());
  await seedMovements(db);
  ctx = await createTestUser(db);
});

describe("normalizeMovementName", () => {
  it("normalizes case, punctuation, and plurals", () => {
    expect(normalizeMovementName("Pull-Ups")).toBe("pull up");
    expect(normalizeMovementName("  Back   Squat ")).toBe("back squat");
    expect(normalizeMovementName("burpees")).toBe("burpee");
  });
});

describe("resolveMovement", () => {
  it("matches seeded movements by name and alias", async () => {
    const byName = await resolveMovement(db, "Back Squat");
    expect(byName.created).toBe(false);
    expect(byName.movement.name).toBe("back squat");

    const byAlias = await resolveMovement(db, "RDL");
    expect(byAlias.created).toBe(false);
    expect(byAlias.movement.name).toBe("romanian deadlift");
  });

  it("creates unverified entries for unknown movements", async () => {
    const r = await resolveMovement(db, "Nordic Curl", {
      category: "hinge",
      primaryMuscles: ["hamstrings"],
    });
    expect(r.created).toBe(true);
    expect(r.movement.verified).toBe(false);
    expect(r.movement.primaryMuscles).toEqual(["hamstrings"]);

    const again = await resolveMovement(db, "nordic curls");
    expect(again.created).toBe(false);
    expect(again.movement.id).toBe(r.movement.id);
  });
});

describe("logWorkout", () => {
  const strengthDay = {
    date: "2026-07-01",
    time: "17:00",
    title: "Upper push",
    blocks: [
      {
        type: "strength" as const,
        movements: [
          {
            name: "bench press",
            prescription: "4x8 @ 185",
            sets: [
              { reps: 8, load: { value: 185, unit: "lb" as const }, rpe: 7 },
              { reps: 8, load: { value: 185, unit: "lb" as const }, rpe: 8 },
              { reps: 8, load: { value: 185, unit: "lb" as const }, rpe: 8.5 },
              { reps: 7, load: { value: 185, unit: "lb" as const }, rpe: 9, isFailure: true },
            ],
          },
          {
            name: "overhead press",
            sets: [{ reps: 10, load: { value: 95, unit: "lb" as const } }],
          },
        ],
      },
    ],
  };

  it("logs a strength session with per-set detail", async () => {
    const result = await logWorkout(db, ctx, strengthDay);
    expect(result.status).toBe("logged");
    if (result.status !== "logged") return;
    expect(result.workout.movementNames).toContain("bench press");
    expect(result.workout.createdMovements).toEqual([]);
  });

  it("logs a run with derived pace", async () => {
    const result = await logWorkout(db, ctx, {
      date: "2026-07-02",
      blocks: [
        {
          type: "run" as const,
          distance: { value: 5, unit: "mi" as const },
          duration: { value: 45, unit: "min" as const },
          avgHr: 152,
          movements: [{ name: "run" }],
        },
      ],
    });
    expect(result.status).toBe("logged");
  });

  it("logs a metcon with scheme, movements, and result", async () => {
    const result = await logWorkout(db, ctx, {
      date: "2026-07-03",
      title: "Fran-ish",
      blocks: [
        {
          type: "metcon" as const,
          scheme: "for_time" as const,
          timeCap: { value: 10, unit: "min" as const },
          resultTime: { value: 7.5, unit: "min" as const },
          rx: true,
          movements: [
            { name: "thruster", prescription: "21-15-9", load: { value: 95, unit: "lb" as const } },
            { name: "pull up", prescription: "21-15-9" },
          ],
        },
      ],
    });
    expect(result.status).toBe("logged");
  });

  it("refuses to silently drop a strength movement with no reps/sets/load", async () => {
    const result = await logWorkout(db, ctx, {
      date: "2026-07-05",
      title: "Lower strength",
      blocks: [
        {
          type: "strength" as const,
          // The real-world bug: movement name only, no sets/prescription/load.
          movements: [{ name: "pause front squat" }, { name: "no lockout back squat" }],
        },
      ],
    });
    expect(result.status).toBe("incomplete_movements");
    if (result.status !== "incomplete_movements") return;
    expect(result.incomplete.map((m) => m.movement)).toEqual([
      "pause front squat",
      "no lockout back squat",
    ]);

    // Nothing was written — no partial session left behind.
    expect(await getRecentWorkouts(db, ctx, 30, new Date("2026-07-06T12:00:00Z"))).toHaveLength(0);
  });

  it("accepts the same movements once sets are supplied", async () => {
    const result = await logWorkout(db, ctx, {
      date: "2026-07-05",
      blocks: [
        {
          type: "strength" as const,
          movements: [
            {
              name: "pause front squat",
              sets: [
                { reps: 5, load: { value: 95, unit: "lb" as const } },
                { reps: 5, load: { value: 95, unit: "lb" as const } },
              ],
            },
          ],
        },
      ],
    });
    expect(result.status).toBe("logged");
  });

  it("exempts bodyweight warmup/cooldown movements from the completeness check", async () => {
    const result = await logWorkout(db, ctx, {
      date: "2026-07-05",
      blocks: [
        { type: "warmup" as const, movements: [{ name: "world's greatest stretch" }] },
        { type: "cooldown" as const, movements: [{ name: "pigeon pose" }] },
      ],
    });
    expect(result.status).toBe("logged");
  });

  it("allows an explicit unquantified strength movement when the user confirms", async () => {
    const result = await logWorkout(db, ctx, {
      date: "2026-07-05",
      allowIncomplete: true,
      blocks: [{ type: "strength" as const, movements: [{ name: "sled push" }] }],
    });
    expect(result.status).toBe("logged");
  });

  it("flags a same-day near-duplicate instead of inserting (§5.9 tier 3)", async () => {
    await logWorkout(db, ctx, strengthDay);
    const dup = await logWorkout(db, ctx, strengthDay);
    expect(dup.status).toBe("possible_duplicate");
    if (dup.status !== "possible_duplicate") return;
    expect(dup.candidates[0]?.movementNames).toContain("bench press");

    // Agent confirms it's intentional
    const forced = await logWorkout(db, ctx, { ...strengthDay, allowDuplicate: true });
    expect(forced.status).toBe("logged");
  });

  it("does not flag different same-day sessions (AM run + PM lift)", async () => {
    await logWorkout(db, ctx, {
      date: "2026-07-04",
      blocks: [
        {
          type: "run" as const,
          distance: { value: 3, unit: "mi" as const },
          movements: [{ name: "run" }],
        },
      ],
    });
    const lift = await logWorkout(db, ctx, {
      date: "2026-07-04",
      blocks: [
        {
          type: "strength" as const,
          movements: [{ name: "back squat", sets: [{ reps: 5, load: { value: 225, unit: "lb" as const } }] }],
        },
      ],
    });
    expect(lift.status).toBe("logged");
  });

  it("returns per-set detail for a named movement", async () => {
    await logWorkout(db, ctx, strengthDay);
    const result = await getMovementHistory(db, ctx, "bench press", 30, new Date("2026-07-02T12:00:00Z"));
    expect(result.found).toBe(true);
    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0]!;
    expect(entry.date).toBe("2026-07-01");
    expect(entry.sets).toHaveLength(4);
    expect(entry.sets[0]!.reps).toBe(8);
    expect(entry.sets[0]!.loadLb).toBeCloseTo(185, 0);
    expect(entry.sets[3]!.isFailure).toBe(true);
  });

  it("returns found:false for a movement never logged", async () => {
    const result = await getMovementHistory(db, ctx, "nordic curl", 90, new Date("2026-07-02T12:00:00Z"));
    expect(result.found).toBe(false);
    expect(result.entries).toHaveLength(0);
  });

  it("matches movement history case-insensitively", async () => {
    await logWorkout(db, ctx, strengthDay);
    // "Bench Press" and "BENCH PRESS" should both hit the stored "bench press"
    const r = await getMovementHistory(db, ctx, "Bench Press", 30, new Date("2026-07-02T12:00:00Z"));
    expect(r.found).toBe(true);
    expect(r.entries).toHaveLength(1);
  });

  it("aggregates muscle-group volume for recent work", async () => {
    await logWorkout(db, ctx, strengthDay);
    const recent = await getRecentWorkouts(db, ctx, 10, new Date("2026-07-02T12:00:00Z"));
    expect(recent).toHaveLength(1);
    expect(recent[0]?.muscleGroups).toContain("chest");

    const volume = await muscleGroupVolume(db, ctx, 7, new Date("2026-07-02T12:00:00Z"));
    expect(volume.chest).toBe(4); // 4 working sets of bench
    expect(volume.triceps).toBeGreaterThanOrEqual(4);
  });

  it("returns only the sessions logged on the requested local date", async () => {
    await logWorkout(db, ctx, strengthDay); // 2026-07-01
    await logWorkout(db, ctx, {
      date: "2026-07-02",
      title: "Zone 2",
      blocks: [
        {
          type: "run" as const,
          distance: { value: 5, unit: "mi" as const },
          duration: { value: 45, unit: "min" as const },
          movements: [{ name: "run" }],
        },
      ],
    });

    const day = await getDayWorkouts(db, ctx, "2026-07-01");
    expect(day).toHaveLength(1);
    expect(day[0]?.session.title).toBe("Upper push");
    expect(day[0]?.movementNames).toContain("bench press");
    expect(day[0]?.muscleGroups).toContain("chest");

    expect(await getDayWorkouts(db, ctx, "2026-07-02")).toHaveLength(1);
    expect(await getDayWorkouts(db, ctx, "2026-07-03")).toHaveLength(0);
  });

  it("returns full block/movement/set detail for a strength session", async () => {
    const logged = await logWorkout(db, ctx, strengthDay);
    if (logged.status !== "logged") throw new Error("expected logged");

    const detail = await getWorkoutDetail(db, ctx, logged.workout.session.id);
    expect(detail).not.toBeNull();
    expect(detail!.session.title).toBe("Upper push");
    expect(detail!.blocks).toHaveLength(1);

    const block = detail!.blocks[0]!;
    expect(block.blockType).toBe("strength");
    expect(block.movements.map((m) => m.name)).toEqual(["bench press", "overhead press"]);

    const bench = block.movements[0]!;
    expect(bench.sets).toHaveLength(4);
    expect(bench.sets[0]).toMatchObject({ setNumber: 1, reps: 8, rpe: 7 });
    // 185 lb stored canonically as kg.
    expect(bench.sets[0]!.loadKg).toBeCloseTo(83.9, 1);
    expect(bench.sets[3]!.isFailure).toBe(true);
  });

  it("returns metcon scheme and result on the block", async () => {
    const logged = await logWorkout(db, ctx, {
      date: "2026-07-04",
      title: "Fran-ish",
      blocks: [
        {
          type: "metcon" as const,
          scheme: "for_time" as const,
          timeCap: { value: 10, unit: "min" as const },
          resultTime: { value: 7.5, unit: "min" as const },
          rx: true,
          movements: [
            { name: "thruster", prescription: "21-15-9", load: { value: 95, unit: "lb" as const } },
            { name: "pull up", prescription: "21-15-9" },
          ],
        },
      ],
    });
    if (logged.status !== "logged") throw new Error("expected logged");

    const detail = await getWorkoutDetail(db, ctx, logged.workout.session.id);
    const block = detail!.blocks[0]!;
    expect(block.scheme).toBe("for_time");
    expect(block.rx).toBe(true);
    expect(block.resultTimeS).toBe(450); // 7.5 min
    expect(block.movements[0]!.loadKg).toBeCloseTo(43.1, 1); // 95 lb
  });

  it("returns null for another user's session", async () => {
    const logged = await logWorkout(db, ctx, strengthDay);
    if (logged.status !== "logged") throw new Error("expected logged");
    const other = await createTestUser(db, { email: "other@example.com" });
    expect(await getWorkoutDetail(db, other, logged.workout.session.id)).toBeNull();
  });
});
