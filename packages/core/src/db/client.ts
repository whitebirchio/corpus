import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * Driver-agnostic database handle. The worker passes a drizzle instance over
 * @neondatabase/serverless; tests pass one over PGlite. Repos work with both.
 *
 * IMPORTANT for every driver: create with `drizzle(client, { casing: "snake_case" })`
 * to match drizzle.config.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, any, any>;

/** Per-request user context resolved from the OAuth grant. */
export interface UserCtx {
  userId: string;
  timezone: string;
  unitPreference: "imperial" | "metric";
}
