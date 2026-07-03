import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import type { Db } from "@corpus/core";

/**
 * Run `fn` against Neon inside a transaction with `app.user_id` set, so
 * Postgres RLS scopes every statement to the authenticated user (specs/01-initial-platform/SPEC.md §7).
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
 * For the OAuth callback only: no user id exists yet, so the users-table RLS
 * policy admits the row matching `app.auth_email` (the verified, allowlisted
 * Google email) for lookup-or-create.
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

export interface QueryDataResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

const MAX_ROWS = 500;
const STATEMENT_TIMEOUT_MS = 8000;

/**
 * Execute one read-only SELECT scoped by RLS (specs/01-initial-platform/SPEC.md §6.2 query_data).
 * Defense in depth: statement allowlist + read-only transaction +
 * statement_timeout + row cap — on top of per-user RLS.
 */
export async function queryData(
  env: Env,
  userId: string,
  rawSql: string,
): Promise<QueryDataResult> {
  const cleaned = rawSql.trim().replace(/;\s*$/, "");
  if (cleaned.includes(";")) {
    throw new Error("Only a single statement is allowed");
  }
  if (!/^\s*(select|with)\b/i.test(cleaned)) {
    throw new Error("Only SELECT (or WITH ... SELECT) statements are allowed");
  }

  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("begin transaction read only");
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    await client.query(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const result = await client.query(cleaned);
    await client.query("commit");
    const rows = (result.rows as Record<string, unknown>[]) ?? [];
    return {
      rows: rows.slice(0, MAX_ROWS),
      rowCount: rows.length,
      truncated: rows.length > MAX_ROWS,
    };
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      // already failed; surface the original error
    }
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
