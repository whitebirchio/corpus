/**
 * MCP tool surface (SPEC.md §6). Thin adapters: validate (Zod shapes from
 * @corpus/core), open an RLS-scoped transaction, call the core repo, echo the
 * result back for confirmation. No business logic lives here.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  endRegimenItemShape,
  formatMass,
  getActiveGoals,
  getActiveRegimen,
  getDailySummary,
  getRecentWorkouts,
  kgToLb,
  logDailyCheckinShape,
  logMeal,
  logMealShape,
  logObservation,
  logObservationShape,
  logRegimenEvent,
  logRegimenEventShape,
  logWorkout,
  logWorkoutShape,
  archiveInsight,
  saveInsight,
  saveInsightShape,
  endRegimenItem,
  setNutritionTargets,
  setNutritionTargetsShape,
  updateGoalStatus,
  updateGoalStatusShape,
  upsertDailyCheckin,
  upsertGoal,
  upsertGoalShape,
  upsertRegimenItem,
  upsertRegimenItemShape,
  type UserCtx,
} from "@corpus/core";
import { queryData, withUserDb } from "./db.js";
import { SCHEMA_DOC } from "./schemaDoc.js";
import type { GrantProps } from "./types.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) },
    ],
  };
}

function err(e: unknown): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
    isError: true,
  };
}

const DEDUP_NOTE =
  "If the result status is 'possible_duplicate', DO NOT retry blindly: show the candidates to the user, ask whether this is a new entry or a correction, and only re-call with allowDuplicate=true if they confirm it is genuinely new.";

export function registerTools(
  server: McpServer,
  env: Env,
  getProps: () => GrantProps,
): void {
  const ctx = (): UserCtx => {
    const p = getProps();
    return { userId: p.userId, timezone: p.timezone, unitPreference: p.unitPreference };
  };
  const run = async <T>(fn: (db: Parameters<Parameters<typeof withUserDb>[2]>[0], c: UserCtx) => Promise<T>) => {
    const c = ctx();
    return withUserDb(env, c.userId, (db) => fn(db, c));
  };

  // --- writes ---------------------------------------------------------------

  server.registerTool(
    "log_daily_checkin",
    {
      title: "Log daily check-in",
      description:
        "Record the morning check-in: sleep, HRV, resting HR, steps, subjective energy, and an optional weigh-in. " +
        "Upserts by date — re-logging a day updates the provided fields and preserves the rest, so it is always safe to call. " +
        "Pass quantities unit-tagged (e.g. weight { value: 178.2, unit: 'lb' }); the server converts.",
      inputSchema: logDailyCheckinShape,
    },
    async (input) => {
      try {
        const result = await run((db, c) => upsertDailyCheckin(db, c, input));
        const p = getProps();
        return ok({
          status: "saved",
          date: result.metrics.localDate,
          metrics: result.metrics,
          weighIn: result.weighIn
            ? { ...result.weighIn, display: formatMass(result.weighIn.weightKg ?? 0, p.unitPreference) }
            : null,
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "log_workout",
    {
      title: "Log workout",
      description:
        "Record a workout session as blocks (strength / run / metcon / warmup / ...). Strength blocks take per-set reps+load+RPE; " +
        "runs take distance/duration/HR (pace derived); metcons take scheme (amrap/emom/for_time/...), movements with rep schemes and loads, and the result. " +
        "Movement names are resolved against the catalog — unknown ones are added unverified (supply category and primaryMuscles for new movements). " +
        DEDUP_NOTE,
      inputSchema: logWorkoutShape,
    },
    async (input) => {
      try {
        const result = await run((db, c) => logWorkout(db, c, input));
        return ok(result);
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "log_meal",
    {
      title: "Log meal",
      description:
        "Record a meal. Prefer itemized entries (items[] with macros and key micros like fiber_g/sat_fat_g/cholesterol_mg) when the meal was described or photographed; " +
        "fall back to totals{} when the user just reports numbers. Totals are computed from items automatically. " +
        DEDUP_NOTE,
      inputSchema: logMealShape,
    },
    async (input) => {
      try {
        const parsed = z.object(logMealShape).parse(input);
        if ((parsed.items?.length ?? 0) === 0 && !parsed.totals) {
          return err(new Error("Provide items or totals"));
        }
        const result = await run((db, c) => logMeal(db, c, parsed));
        return ok(result);
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "set_nutrition_targets",
    {
      title: "Set nutrition targets",
      description:
        "Set macro targets effective from a date (defaults to today). Targets are effective-dated: " +
        "the latest row on or before a given day governs it, so updating MacroFactor's weekly adjustment is one call.",
      inputSchema: setNutritionTargetsShape,
    },
    async (input) => {
      try {
        return ok(await run((db, c) => setNutritionTargets(db, c, input)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "log_observation",
    {
      title: "Log observation",
      description:
        "Record a subjective observation: energy, mood, soreness, symptom, or free note. " +
        "Cheap to log; valuable for correlations (e.g. afternoon energy vs. lunch composition).",
      inputSchema: logObservationShape,
    },
    async (input) => {
      try {
        return ok(await run((db, c) => logObservation(db, c, input)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "upsert_regimen_item",
    {
      title: "Add or update medication/supplement",
      description:
        "Add a medication or supplement to the current regimen, or update it. A dose/schedule change automatically " +
        "ends the current row and opens a new one so history is preserved for correlation with labs and biometrics. " +
        "Include purpose (why it's taken) — it feeds analysis context.",
      inputSchema: upsertRegimenItemShape,
    },
    async (input) => {
      try {
        return ok(await run((db, c) => upsertRegimenItem(db, c, input)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "end_regimen_item",
    {
      title: "Stop medication/supplement",
      description: "Mark an active regimen item as ended (kept in history).",
      inputSchema: endRegimenItemShape,
    },
    async (input) => {
      try {
        return ok(await run((db, c) => endRegimenItem(db, c, input)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "log_regimen_event",
    {
      title: "Log regimen exception",
      description:
        "Record an adherence exception for an active regimen item: skipped, extra_dose, paused, resumed. " +
        "Adherence is otherwise assumed — only deviations need logging.",
      inputSchema: logRegimenEventShape,
    },
    async (input) => {
      try {
        return ok(await run((db, c) => logRegimenEvent(db, c, input)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "upsert_goal",
    {
      title: "Add or update goal",
      description:
        "Create or update a health/fitness goal. Matches by id when given, else by title (idempotent). " +
        "Lower priority number = more important.",
      inputSchema: upsertGoalShape,
    },
    async (input) => {
      try {
        return ok(await run((db, c) => upsertGoal(db, c, input)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "update_goal_status",
    {
      title: "Update goal status",
      description: "Set a goal to active, paused, achieved, or abandoned.",
      inputSchema: updateGoalStatusShape,
    },
    async (input) => {
      try {
        return ok(await run((db, c) => updateGoalStatus(db, c, input)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "save_insight",
    {
      title: "Save insight",
      description:
        "Persist a durable conclusion or working hypothesis (e.g. 'LDL elevated on 2026-06 panel; prioritizing fiber; retest Q4'). " +
        "Insights surface in every daily summary — save what future conversations should know instead of re-deriving it.",
      inputSchema: saveInsightShape,
    },
    async (input) => {
      try {
        return ok(await run((db, c) => saveInsight(db, c, input)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "archive_insight",
    {
      title: "Archive insight",
      description: "Archive an insight that no longer applies.",
      inputSchema: { id: z.uuid() },
    },
    async ({ id }) => {
      try {
        return ok(await run((db, c) => archiveInsight(db, c, id)));
      } catch (e) {
        return err(e);
      }
    },
  );

  // --- reads ----------------------------------------------------------------

  server.registerTool(
    "get_daily_summary",
    {
      title: "Get daily summary",
      description:
        "The morning-briefing payload for a date (default today): last night's sleep/HRV/RHR, today's macros vs targets, " +
        "recent training with muscle-group volume (7d), active goals by priority, current regimen, standing insights, " +
        "and today's observations. Call this FIRST in any daily conversation.",
      inputSchema: { date: z.iso.date().optional() },
    },
    async ({ date }) => {
      try {
        const summary = await run((db, c) => getDailySummary(db, c, date));
        const p = getProps();
        return ok({
          ...summary,
          latestWeight:
            summary.latestWeightKg != null
              ? {
                  kg: summary.latestWeightKg,
                  lb: Math.round(kgToLb(summary.latestWeightKg) * 10) / 10,
                  display: formatMass(summary.latestWeightKg, p.unitPreference),
                }
              : null,
        });
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "get_recent_workouts",
    {
      title: "Get recent workouts",
      description: "Sessions in the trailing window (default 10 days), newest first, with movements and muscle groups.",
      inputSchema: { days: z.number().int().min(1).max(90).optional() },
    },
    async ({ days }) => {
      try {
        return ok(await run((db, c) => getRecentWorkouts(db, c, days ?? 10)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "get_regimen",
    {
      title: "Get current regimen",
      description: "All active medications and supplements with doses, schedules, and purposes.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await run((db, c) => getActiveRegimen(db, c)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "get_goals",
    {
      title: "Get active goals",
      description: "Active goals ordered by priority (most important first).",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await run((db, c) => getActiveGoals(db, c)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "query_data",
    {
      title: "Query data (read-only SQL)",
      description:
        "Run a single read-only SELECT against the Corpus database for open-ended analysis. " +
        "Read the corpus://schema resource first for tables, units (canonical metric!), and example queries. " +
        "Rows are RLS-scoped to the user automatically; results cap at 500 rows.",
      inputSchema: {
        sql: z.string().min(1).describe("One SELECT or WITH...SELECT statement"),
      },
    },
    async ({ sql }) => {
      try {
        const c = ctx();
        const result = await queryData(env, c.userId, sql);
        return ok(result);
      } catch (e) {
        return err(e);
      }
    },
  );

  // --- resources --------------------------------------------------------------

  server.registerResource(
    "schema",
    "corpus://schema",
    {
      title: "Corpus schema reference",
      description:
        "Annotated database schema: tables, columns, enums, canonical units, and example queries for query_data.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: SCHEMA_DOC }],
    }),
  );
}
