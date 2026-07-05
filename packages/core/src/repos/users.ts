import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { users } from "../db/schema.js";

export type User = typeof users.$inferSelect;

/**
 * Called from the OAuth callback with a verified, allowlisted email. No user
 * context exists yet, so the caller must have set the `app.auth_email`
 * session setting to this email — the users-table RLS policy admits the
 * matching row through it (see withAuthDb in the worker).
 */
export async function findOrCreateUser(
  db: Db,
  email: string,
  displayName: string,
  timezone: string,
): Promise<User> {
  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(users)
    .values({ email, displayName, timezone })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (inserted[0]) return inserted[0];
  // Raced with a concurrent insert; fetch the winner.
  const winner = await db.select().from(users).where(eq(users.email, email));
  if (!winner[0]) throw new Error(`Failed to find or create user ${email}`);
  return winner[0];
}

export async function getUser(db: Db, userId: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, userId));
  return rows[0];
}

/** Where to check the weather when planning training (specs/04-training-plans/SPEC.md decision #9). */
export async function setHomeLocation(db: Db, userId: string, location: string): Promise<User> {
  const rows = await db
    .update(users)
    .set({ homeLocation: location, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  const u = rows[0];
  if (!u) throw new Error(`User ${userId} not found`);
  return u;
}
