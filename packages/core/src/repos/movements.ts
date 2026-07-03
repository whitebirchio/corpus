import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { movements } from "../db/schema.js";

export type Movement = typeof movements.$inferSelect;
export type MovementCategory = Movement["category"];

/**
 * Normalize a movement name for matching: lowercase, strip punctuation,
 * collapse whitespace, naive singularization of each word ("pull-ups" and
 * "pull up" both normalize to "pull up").
 */
export function normalizeMovementName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length > 2 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

/**
 * Resolve a conversational movement name to a catalog row, creating an
 * unverified entry when nothing matches (specs/01-initial-platform/SPEC.md §6.1 log_workout). Matching
 * is against normalized canonical names and aliases.
 */
export async function resolveMovement(
  db: Db,
  name: string,
  opts?: { category?: MovementCategory; primaryMuscles?: string[] },
): Promise<{ movement: Movement; created: boolean }> {
  const normalized = normalizeMovementName(name);

  const matches = (await db.execute(
    sql`select * from movements
        where ${normalized} = lower(name)
           or ${normalized} = any(select lower(a) from unnest(aliases) as a)
        limit 1`,
  )) as unknown as { rows?: Movement[] } | Movement[];
  const rows = Array.isArray(matches) ? matches : (matches.rows ?? []);
  const found = rows[0];
  if (found) return { movement: normalizeRow(found), created: false };

  const inserted = await db
    .insert(movements)
    .values({
      name: normalized,
      aliases: normalized === name.toLowerCase().trim() ? [] : [name.toLowerCase().trim()],
      category: opts?.category ?? "other",
      primaryMuscles: opts?.primaryMuscles ?? [],
      verified: false,
    })
    .onConflictDoNothing({ target: movements.name })
    .returning();
  if (inserted[0]) return { movement: inserted[0], created: true };

  // Lost a race; re-query.
  const retry = await resolveMovement(db, name, opts);
  return retry;
}

/**
 * Raw db.execute() rows come back snake_cased (drizzle casing mapping only
 * applies to query-builder queries). Map the columns we use.
 */
function normalizeRow(row: Record<string, unknown>): Movement {
  if ("primaryMuscles" in row) return row as unknown as Movement;
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases,
    category: row.category,
    primaryMuscles: row.primary_muscles,
    secondaryMuscles: row.secondary_muscles,
    equipment: row.equipment,
    verified: row.verified,
    createdAt: row.created_at,
  } as Movement;
}
