import { beforeEach, describe, expect, it } from "vitest";
import type { Db, UserCtx } from "../src/db/client.js";
import { upsertGoal } from "../src/repos/goals.js";
import { getMilestones, updateMilestoneStatus, upsertMilestone } from "../src/repos/training.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;
let goalId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ctx = await createTestUser(db);
  const goal = await upsertGoal(db, ctx, {
    title: "Run a 40-mile ultramarathon at age 40",
    domain: "fitness",
  });
  goalId = goal.id;
});

describe("upsertMilestone", () => {
  it("creates, matches by title (case-insensitive), and updates by id", async () => {
    const created = await upsertMilestone(db, ctx, {
      goalId,
      title: "30 mi/week base",
      target: { metric: "weekly_mileage", targetValue: 30, unit: "mi", direction: "increase" },
      targetDate: "2026-12-31",
    });
    expect(created.status).toBe("active");

    // Same title, different case → updates the existing row, no duplicate.
    const rematched = await upsertMilestone(db, ctx, {
      goalId,
      title: "30 MI/WEEK BASE",
      targetDate: "2027-01-31",
    });
    expect(rematched.id).toBe(created.id);
    expect(rematched.targetDate).toBe("2027-01-31");

    const byId = await upsertMilestone(db, ctx, {
      id: created.id,
      goalId,
      title: "30 mi/week aerobic base",
    });
    expect(byId.id).toBe(created.id);
    expect(byId.title).toBe("30 mi/week aerobic base");

    expect(await getMilestones(db, ctx)).toHaveLength(1);
  });

  it("orders milestones by target date and filters by goal/status", async () => {
    await upsertMilestone(db, ctx, { goalId, title: "50k finish", targetDate: "2028-05-01" });
    await upsertMilestone(db, ctx, { goalId, title: "Trail half", targetDate: "2027-05-01" });
    await upsertMilestone(db, ctx, { goalId, title: "Someday maybe" }); // undated → last

    const all = await getMilestones(db, ctx, { goalId });
    expect(all.map((m) => m.title)).toEqual(["Trail half", "50k finish", "Someday maybe"]);
  });

  it("refuses a goal the user doesn't own", async () => {
    const other = await createTestUser(db, { email: "other@example.com" });
    await expect(upsertMilestone(db, other, { goalId, title: "sneaky" })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("updateMilestoneStatus", () => {
  it("updates status and stamps statusChangedAt", async () => {
    const m = await upsertMilestone(db, ctx, { goalId, title: "Trail half" });
    const updated = await updateMilestoneStatus(db, ctx, {
      id: m.id,
      status: "achieved",
      notes: "Finished in 2:05",
    });
    expect(updated.status).toBe("achieved");
    expect(updated.statusChangedAt.getTime()).toBeGreaterThanOrEqual(m.statusChangedAt.getTime());

    const active = await getMilestones(db, ctx, { status: "active" });
    expect(active).toHaveLength(0);
  });
});
