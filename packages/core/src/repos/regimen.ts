import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db, UserCtx } from "../db/client.js";
import { regimenEvents, regimenItems } from "../db/schema.js";
import type {
  EndRegimenItemInput,
  LogRegimenEventInput,
  UpsertRegimenItemInput,
} from "../schemas/inputs.js";
import { todayIn } from "../time.js";

export type RegimenItem = typeof regimenItems.$inferSelect;
export type RegimenEvent = typeof regimenEvents.$inferSelect;

async function findActiveByName(
  db: Db,
  ctx: UserCtx,
  name: string,
): Promise<RegimenItem | undefined> {
  const rows = await db
    .select()
    .from(regimenItems)
    .where(
      and(
        eq(regimenItems.userId, ctx.userId),
        isNull(regimenItems.endedOn),
        sql`lower(${regimenItems.name}) = ${name.toLowerCase().trim()}`,
      ),
    );
  return rows[0];
}

export type UpsertRegimenResult =
  | { action: "created"; item: RegimenItem }
  | { action: "updated"; item: RegimenItem }
  | { action: "dose_changed"; item: RegimenItem; previous: RegimenItem };

/**
 * specs/01-initial-platform/SPEC.md §5.5: a dose/schedule change ends the current row and opens a new
 * one (history preserved for correlation); metadata-only changes update in
 * place; a brand-new substance inserts.
 */
export async function upsertRegimenItem(
  db: Db,
  ctx: UserCtx,
  input: UpsertRegimenItemInput,
): Promise<UpsertRegimenResult> {
  const startedOn = input.startedOn ?? todayIn(ctx.timezone);
  const existing = await findActiveByName(db, ctx, input.name);

  const values = {
    name: input.name.trim(),
    type: input.type,
    doseAmount: input.doseAmount,
    doseUnit: input.doseUnit,
    scheduleText: input.scheduleText,
    schedule:
      input.timesPerDay !== undefined || input.timing !== undefined
        ? { timesPerDay: input.timesPerDay, timing: input.timing }
        : undefined,
    purpose: input.purpose,
    prescriber: input.prescriber,
    notes: input.notes,
  };

  if (!existing) {
    const rows = await db
      .insert(regimenItems)
      .values({ userId: ctx.userId, startedOn, ...values })
      .onConflictDoUpdate({
        target: [regimenItems.userId, regimenItems.name, regimenItems.startedOn],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    const item = rows[0];
    if (!item) throw new Error("regimen_items upsert returned no row");
    return { action: "created", item };
  }

  const doseChanged =
    (input.doseAmount !== undefined && input.doseAmount !== existing.doseAmount) ||
    (input.doseUnit !== undefined && input.doseUnit !== existing.doseUnit) ||
    (input.scheduleText !== undefined && input.scheduleText !== existing.scheduleText);

  if (doseChanged) {
    return await db.transaction(async (tx) => {
      const endDate = input.startedOn ?? todayIn(ctx.timezone);
      await tx
        .update(regimenItems)
        .set({ endedOn: endDate, updatedAt: new Date() })
        .where(eq(regimenItems.id, existing.id));
      const rows = await tx
        .insert(regimenItems)
        .values({ userId: ctx.userId, startedOn: endDate, ...values })
        .returning();
      const item = rows[0];
      if (!item) throw new Error("regimen_items insert returned no row");
      await tx.insert(regimenEvents).values({
        userId: ctx.userId,
        regimenItemId: item.id,
        localDate: endDate,
        eventType: "dose_changed",
        notes: `Was: ${existing.doseAmount ?? "?"} ${existing.doseUnit ?? ""} ${existing.scheduleText ?? ""}`.trim(),
      });
      return { action: "dose_changed", item, previous: existing };
    });
  }

  const rows = await db
    .update(regimenItems)
    .set({
      purpose: input.purpose ?? existing.purpose,
      prescriber: input.prescriber ?? existing.prescriber,
      notes: input.notes ?? existing.notes,
      updatedAt: new Date(),
    })
    .where(eq(regimenItems.id, existing.id))
    .returning();
  const item = rows[0];
  if (!item) throw new Error("regimen_items update returned no row");
  return { action: "updated", item };
}

export async function endRegimenItem(
  db: Db,
  ctx: UserCtx,
  input: EndRegimenItemInput,
): Promise<RegimenItem> {
  const existing = await findActiveByName(db, ctx, input.name);
  if (!existing) throw new Error(`No active regimen item named "${input.name}"`);
  const endedOn = input.endedOn ?? todayIn(ctx.timezone);
  const rows = await db
    .update(regimenItems)
    .set({
      endedOn,
      notes: input.reason
        ? `${existing.notes ? existing.notes + "\n" : ""}Ended: ${input.reason}`
        : existing.notes,
      updatedAt: new Date(),
    })
    .where(eq(regimenItems.id, existing.id))
    .returning();
  const item = rows[0];
  if (!item) throw new Error("regimen_items update returned no row");
  return item;
}

export async function logRegimenEvent(
  db: Db,
  ctx: UserCtx,
  input: LogRegimenEventInput,
): Promise<RegimenEvent> {
  const item = await findActiveByName(db, ctx, input.name);
  if (!item) throw new Error(`No active regimen item named "${input.name}"`);
  const rows = await db
    .insert(regimenEvents)
    .values({
      userId: ctx.userId,
      regimenItemId: item.id,
      localDate: input.date ?? todayIn(ctx.timezone),
      eventType: input.eventType,
      notes: input.notes,
    })
    .returning();
  const event = rows[0];
  if (!event) throw new Error("regimen_events insert returned no row");
  return event;
}

export async function getActiveRegimen(db: Db, ctx: UserCtx): Promise<RegimenItem[]> {
  return db
    .select()
    .from(regimenItems)
    .where(and(eq(regimenItems.userId, ctx.userId), isNull(regimenItems.endedOn)))
    .orderBy(asc(regimenItems.name));
}
