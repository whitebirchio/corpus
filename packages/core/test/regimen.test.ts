import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db, UserCtx } from "../src/db/client.js";
import { regimenEvents } from "../src/db/schema.js";
import {
  endRegimenItem,
  getActiveRegimen,
  logRegimenEvent,
  upsertRegimenItem,
} from "../src/repos/regimen.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ctx = await createTestUser(db);
});

describe("regimen", () => {
  it("creates a new item", async () => {
    const r = await upsertRegimenItem(db, ctx, {
      name: "Vitamin D3",
      type: "supplement",
      doseAmount: 5000,
      doseUnit: "IU",
      scheduleText: "1x daily, morning",
      purpose: "25-OH vitamin D was 28 (low) on 2026-06 Function panel",
      startedOn: "2026-07-01",
    });
    expect(r.action).toBe("created");
    expect((await getActiveRegimen(db, ctx)).map((i) => i.name)).toContain("Vitamin D3");
  });

  it("ends the old row and opens a new one on dose change (§5.5)", async () => {
    await upsertRegimenItem(db, ctx, {
      name: "Vitamin D3",
      type: "supplement",
      doseAmount: 2000,
      doseUnit: "IU",
      startedOn: "2026-01-01",
    });
    const changed = await upsertRegimenItem(db, ctx, {
      name: "Vitamin D3",
      type: "supplement",
      doseAmount: 5000,
      doseUnit: "IU",
      startedOn: "2026-07-01",
    });
    expect(changed.action).toBe("dose_changed");
    if (changed.action !== "dose_changed") return;
    expect(changed.previous.doseAmount).toBe(2000);
    expect(changed.item.doseAmount).toBe(5000);

    const active = await getActiveRegimen(db, ctx);
    expect(active).toHaveLength(1);
    expect(active[0]?.doseAmount).toBe(5000);

    const events = await db
      .select()
      .from(regimenEvents)
      .where(eq(regimenEvents.eventType, "dose_changed"));
    expect(events).toHaveLength(1);
  });

  it("updates metadata in place when dose is unchanged", async () => {
    await upsertRegimenItem(db, ctx, {
      name: "Creatine",
      type: "supplement",
      doseAmount: 5,
      doseUnit: "g",
      startedOn: "2026-01-01",
    });
    const r = await upsertRegimenItem(db, ctx, {
      name: "Creatine",
      type: "supplement",
      doseAmount: 5,
      doseUnit: "g",
      purpose: "strength/lean mass support",
    });
    expect(r.action).toBe("updated");
    expect((await getActiveRegimen(db, ctx)).length).toBe(1);
  });

  it("ends an item and logs adherence exceptions", async () => {
    await upsertRegimenItem(db, ctx, {
      name: "Fish Oil",
      type: "supplement",
      startedOn: "2026-01-01",
    });
    await logRegimenEvent(db, ctx, { name: "Fish Oil", eventType: "skipped", date: "2026-07-01" });
    await endRegimenItem(db, ctx, { name: "Fish Oil", endedOn: "2026-07-02", reason: "switched brands" });
    expect(await getActiveRegimen(db, ctx)).toHaveLength(0);
    await expect(
      logRegimenEvent(db, ctx, { name: "Fish Oil", eventType: "skipped" }),
    ).rejects.toThrow(/No active regimen item/);
  });
});
