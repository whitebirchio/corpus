/**
 * Seed the movement catalog into the real database (idempotent).
 * Usage: DATABASE_URL=postgres://... npm run db:seed -w @corpus/core
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { Db } from "../src/db/client.js";
import { seedMovements } from "../src/seed/movements.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = drizzle(neon(url), { casing: "snake_case" }) as unknown as Db;
const result = await seedMovements(db);
console.log(`Movements seeded: ${result.inserted} inserted, ${result.total} in catalog.`);
