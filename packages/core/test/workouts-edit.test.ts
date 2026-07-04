import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db, UserCtx } from "../src/db/client.js";
import {
  blockMovements,
  strengthSets,
  workoutBlocks,
  workoutSessions,
} from "../src/db/schema.js";
import { deleteWorkout, logWorkout, updateWorkout } from "../src/repos/workouts.js";
import { seedMovements } from "../src/seed/movements.js";
import { localTimeOf } from "../src/time.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;

beforeEach(async () => {
  ({ db } = await createTestDb());
  await seedMovements(db);
  ctx = await createTestUser(db);
});

async function logStrengthDay() {
  const r = await logWorkout(db, ctx, {
    date: "2026-07-01",
    time: "17:00",
    title: "Upper push",
    sessionRpe: 7,
    blocks: [
      {
        type: "strength" as const,
        movements: [
          {
            name: "bench press",
            sets: [
              { reps: 8, load: { value: 185, unit: "lb" as const }, rpe: 8 },
              { reps: 8, load: { value: 185, unit: "lb" as const }, rpe: 8.5 },
            ],
          },
        ],
      },
    ],
  });
  if (r.status !== "logged") throw new Error(`setup log failed: ${r.status}`);
  return r.workout.session;
}

describe("updateWorkout", () => {
  it("patches session-level fields without touching blocks/movements/sets", async () => {
    const session = await logStrengthDay();
    const res = await updateWorkout(db, ctx, {
      sessionId: session.id,
      title: "Upper push (heavy)",
      sessionRpe: 9,
      duration: { value: 55, unit: "min" },
      notes: "felt strong",
    });
    expect(res.status).toBe("updated");
    if (res.status !== "updated") return;
    expect(res.session.title).toBe("Upper push (heavy)");
    expect(res.session.sessionRpe).toBe(9);
    expect(res.session.durationS).toBe(3300);
    expect(res.session.notes).toBe("felt strong");

    // Blocks/movements/sets are untouched.
    const blocks = await db
      .select()
      .from(workoutBlocks)
      .where(eq(workoutBlocks.sessionId, session.id));
    expect(blocks).toHaveLength(1);
    const bms = await db
      .select()
      .from(blockMovements)
      .where(
        inArray(
          blockMovements.blockId,
          blocks.map((b) => b.id),
        ),
      );
    const sets = await db
      .select()
      .from(strengthSets)
      .where(
        inArray(
          strengthSets.blockMovementId,
          bms.map((m) => m.id),
        ),
      );
    expect(sets).toHaveLength(2);
  });

  it("recomputes startedAt/localDate on a date change, preserving the original time", async () => {
    const session = await logStrengthDay();
    expect(localTimeOf(session.startedAt, ctx.timezone)).toBe("17:00");

    const res = await updateWorkout(db, ctx, { sessionId: session.id, date: "2026-07-02" });
    expect(res.status).toBe("updated");
    if (res.status !== "updated") return;
    expect(res.session.localDate).toBe("2026-07-02");
    expect(localTimeOf(res.session.startedAt, ctx.timezone)).toBe("17:00");
  });

  it("returns not_found for an unknown id", async () => {
    const res = await updateWorkout(db, ctx, {
      sessionId: "00000000-0000-0000-0000-000000000000",
      title: "x",
    });
    expect(res.status).toBe("not_found");
  });

  it("refuses to edit an imported (non-conversation) session", async () => {
    const rows = await db
      .insert(workoutSessions)
      .values({
        userId: ctx.userId,
        startedAt: new Date("2026-07-01T13:00:00Z"),
        localDate: "2026-07-01",
        title: "Garmin run",
        source: "garmin_export",
        sourceRef: "activity-42",
      })
      .returning();
    const imported = rows[0];
    if (!imported) throw new Error("insert failed");

    const res = await updateWorkout(db, ctx, { sessionId: imported.id, title: "hacked" });
    expect(res.status).toBe("not_editable");
    if (res.status !== "not_editable") return;
    expect(res.source).toBe("garmin_export");

    const still = await db
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, imported.id));
    expect(still[0]?.title).toBe("Garmin run");
  });
});

describe("deleteWorkout", () => {
  it("deletes the session and cascades blocks, movements, and sets", async () => {
    const session = await logStrengthDay();
    const blocksBefore = await db
      .select()
      .from(workoutBlocks)
      .where(eq(workoutBlocks.sessionId, session.id));
    const blockIds = blocksBefore.map((b) => b.id);
    const bmsBefore = await db
      .select()
      .from(blockMovements)
      .where(inArray(blockMovements.blockId, blockIds));
    const bmIds = bmsBefore.map((m) => m.id);

    const res = await deleteWorkout(db, ctx, session.id);
    expect(res.status).toBe("deleted");

    expect(
      await db.select().from(workoutSessions).where(eq(workoutSessions.id, session.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(workoutBlocks).where(inArray(workoutBlocks.id, blockIds)),
    ).toHaveLength(0);
    expect(
      await db.select().from(blockMovements).where(inArray(blockMovements.id, bmIds)),
    ).toHaveLength(0);
    expect(
      await db.select().from(strengthSets).where(inArray(strengthSets.blockMovementId, bmIds)),
    ).toHaveLength(0);
  });

  it("returns not_found for an unknown id", async () => {
    const res = await deleteWorkout(db, ctx, "00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe("not_found");
  });

  it("refuses to delete an imported session", async () => {
    const rows = await db
      .insert(workoutSessions)
      .values({
        userId: ctx.userId,
        startedAt: new Date("2026-07-01T13:00:00Z"),
        localDate: "2026-07-01",
        title: "Garmin run",
        source: "garmin_export",
        sourceRef: "activity-99",
      })
      .returning();
    const imported = rows[0];
    if (!imported) throw new Error("insert failed");

    const res = await deleteWorkout(db, ctx, imported.id);
    expect(res.status).toBe("not_editable");
    expect(
      await db.select().from(workoutSessions).where(eq(workoutSessions.id, imported.id)),
    ).toHaveLength(1);
  });
});
