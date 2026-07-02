/**
 * Ad hoc scratchpad — poke at the domain core against a throwaway in-memory
 * Postgres (PGlite), with the real schema + seeded movements + a test user.
 * No network, no Neon, no Cloudflare. Nothing here touches your live data.
 *
 * Run once:      npm run scratch -w @corpus/core
 * Run on change: npm run scratch:watch -w @corpus/core
 *
 * Edit the SCRATCH ZONE below freely — it's yours to throw away.
 */
import { createTestDb, createTestUser } from "../test/helpers.js";
import { seedMovements } from "../src/seed/movements.js";
import * as corpus from "../src/index.js";

const { db } = await createTestDb();
await seedMovements(db);
const ctx = await createTestUser(db, { timezone: "America/New_York" });

const show = (label: string, value: unknown) =>
  console.log(`\n=== ${label} ===\n${JSON.stringify(value, null, 2)}`);

// ─────────────────────────── SCRATCH ZONE ───────────────────────────
// Everything above is fixed setup. Everything below is yours to change.

const workout = await corpus.logWorkout(db, ctx, {
  date: "2026-07-02",
  title: "Push + intervals",
  blocks: [
    {
      type: "strength",
      movements: [
        {
          name: "bench press",
          prescription: "4x8 @ 185",
          sets: [
            { reps: 8, load: { value: 185, unit: "lb" }, rpe: 7 },
            { reps: 8, load: { value: 185, unit: "lb" }, rpe: 8 },
          ],
        },
      ],
    },
    {
      type: "metcon",
      scheme: "amrap",
      timeCap: { value: 12, unit: "min" },
      resultRounds: 8,
      resultReps: 5,
      movements: [
        { name: "thruster", repsPerRound: 10, load: { value: 95, unit: "lb" } },
        { name: "pull up", repsPerRound: 10 },
      ],
    },
  ],
});
show("logWorkout", workout);

const volume = await corpus.muscleGroupVolume(db, ctx, 7, new Date("2026-07-03T12:00:00Z"));
show("muscleGroupVolume (7d)", volume);

const summary = await corpus.getDailySummary(db, ctx, "2026-07-02");
show("getDailySummary", summary);

// ─────────────────────────────────────────────────────────────────────
process.exit(0);
