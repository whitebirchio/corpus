/**
 * Apply pending migrations to the real database (idempotent — drizzle tracks
 * applied migrations in __drizzle_migrations and skips them).
 *
 * Uses the Neon serverless HTTP driver (same as seed.ts and the worker) rather
 * than drizzle-kit's auto-selected client: it speaks Neon's TLS natively, so it
 * avoids both the WebSocket-only limitation of the serverless driver under the
 * plain CLI and the `pg` sslmode/verify-full handling that trips up local runs.
 *
 * Usage: DATABASE_URL=postgres://... npm run db:migrate -w @corpus/core
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Export your Neon connection string first:\n" +
      "  export DATABASE_URL='postgres://...'  (see docs/SETUP.md §1)",
  );
  process.exit(1);
}

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

const db = drizzle(neon(url), { casing: "snake_case" });
await migrate(db, { migrationsFolder });
console.log("Migrations applied.");
