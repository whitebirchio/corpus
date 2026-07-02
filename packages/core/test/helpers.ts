import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Db, UserCtx } from "../src/db/client.js";
import { users } from "../src/db/schema.js";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
  "0000_init.sql",
);

/**
 * Fresh in-memory Postgres with the real migration applied. Note: PGlite runs
 * as superuser so RLS is bypassed here — repos must (and do) filter by
 * user_id explicitly; RLS is the belt-and-braces layer for query_data.
 */
export async function createTestDb(): Promise<{ db: Db; pglite: PGlite }> {
  const pglite = new PGlite();
  const sql = readFileSync(migrationPath, "utf8");
  await pglite.exec(sql);
  const db = drizzle(pglite, { casing: "snake_case" }) as unknown as Db;
  return { db, pglite };
}

export async function createTestUser(
  db: Db,
  overrides?: Partial<{ email: string; timezone: string }>,
): Promise<UserCtx> {
  const rows = await db
    .insert(users)
    .values({
      email: overrides?.email ?? "scott@example.com",
      displayName: "Scott",
      timezone: overrides?.timezone ?? "America/New_York",
    })
    .returning();
  const u = rows[0];
  if (!u) throw new Error("failed to create test user");
  return { userId: u.id, timezone: u.timezone, unitPreference: u.unitPreference };
}
