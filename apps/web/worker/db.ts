/**
 * RLS-scoped Neon access — same pattern as apps/mcp-server/src/db.ts (the
 * spec's decision #9: the REST adapter changes nothing about data access).
 * Duplicated rather than shared: core stays driver-wiring-free, and ~40 lines
 * across two adapters doesn't yet justify a package (revisit on a third).
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import type { Db } from "@corpus/core";

/**
 * Run `fn` inside a transaction with `app.user_id` set, so Postgres RLS
 * scopes every statement to the authenticated user (specs/01-initial-platform/SPEC.md §7).
 * A fresh Pool per call: Workers isolates can't reliably share sockets across
 * requests, and Neon's serverless driver is built for this pattern.
 */
export async function withUserDb<T>(
  env: Env,
  userId: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const db = drizzle(pool, { casing: "snake_case" });
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
      return fn(tx as unknown as Db);
    });
  } finally {
    await pool.end();
  }
}

/**
 * For the sign-in callback only: no user id exists yet, so the users-table
 * RLS policy admits the row matching `app.auth_email` (the verified,
 * allowlisted Google email) for lookup-or-create.
 */
export async function withAuthDb<T>(
  env: Env,
  email: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const db = drizzle(pool, { casing: "snake_case" });
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.auth_email', ${email}, true)`);
      return fn(tx as unknown as Db);
    });
  } finally {
    await pool.end();
  }
}
