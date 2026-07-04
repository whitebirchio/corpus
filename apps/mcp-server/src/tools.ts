/**
 * MCP tool surface (specs/01-initial-platform/SPEC.md §6). Thin adapters: validate (Zod shapes from
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
  updateMeal,
  updateMealShape,
  deleteMeal,
  deleteMealShape,
  updateWorkout,
  updateWorkoutShape,
  deleteWorkout,
  deleteWorkoutShape,
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
  createDocument,
  createDocumentUploadShape,
  getLabHistory,
  getMovementHistory,
  getMovementHistoryShape,
  recordFitnessTest,
  recordFitnessTestShape,
  recordLabPanel,
  recordLabPanelShape,
  ANALYTES,
  type UserCtx,
} from "@corpus/core";
import { queryData, withUserDb } from "./db.js";
import { renderProfile } from "./profile.js";
import { SCHEMA_DOC } from "./schemaDoc.js";
import { issueUploadToken, uploadUrlFor, UPLOAD_TTL_SECONDS } from "./upload.js";
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
        "Record a workout session as blocks (strength / run / metcon / warmup / ...). " +
        "CRITICAL — where reps/weight go depends on the movement, and getting this wrong silently loses data: " +
        "(1) Any movement done as SETS — every strength lift AND weighted accessories — MUST include a `sets` array, one entry per set with reps + unit-tagged load " +
        "(e.g. front squat 5x5 @ 95lb => five sets of { reps: 5, load: {value: 95, unit: 'lb'} }; bodyweight sets omit load). " +
        "(2) Only true METCON movements use block-level repsPerRound/load. (3) Runs take distance/duration/HR on the block (pace derived). " +
        "Do NOT put a strength movement's reps/weight only in `prescription` — that text is a fallback, not structured data. " +
        "Movement names are resolved against the catalog — unknown ones are added unverified (supply category and primaryMuscles for new movements). " +
        "If the result status is 'incomplete_movements', the listed strength/metcon movements had no reps/sets/load — ask the user for those numbers and re-call " +
        "with proper `sets` (or allowIncomplete:true only if the user confirms there genuinely were none). " +
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

  const EDIT_SCOPE_NOTE =
    "Only conversation-logged records can be edited or deleted; imported records (Garmin, MacroFactor) " +
    "return status 'not_editable' — surface that to the user rather than retrying. Status 'not_found' means the id was wrong.";

  server.registerTool(
    "update_meal",
    {
      title: "Edit a meal",
      description:
        "Correct a previously logged meal. Get its id from get_daily_summary (nutrition.meals[].id). " +
        "All fields are optional and patched in place (omitted = unchanged). " +
        "To fix macros: pass `items` to REPLACE the itemized breakdown (totals are recomputed), or pass `totals` to set the numbers directly. " +
        "Passing `totals` on an itemized meal switches it to totals and drops its items. Do not pass both. " +
        EDIT_SCOPE_NOTE,
      inputSchema: updateMealShape,
    },
    async (input) => {
      try {
        const parsed = z
          .object(updateMealShape)
          .refine((m) => !(m.items && m.totals), { message: "Provide items or totals, not both" })
          .parse(input);
        return ok(await run((db, c) => updateMeal(db, c, parsed)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "delete_meal",
    {
      title: "Delete a meal",
      description:
        "Delete a logged meal and its items. Get the id from get_daily_summary (nutrition.meals[].id). " +
        "Confirm with the user before calling — this is destructive. " +
        EDIT_SCOPE_NOTE,
      inputSchema: deleteMealShape,
    },
    async ({ mealId }) => {
      try {
        return ok(await run((db, c) => deleteMeal(db, c, mealId)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "update_workout",
    {
      title: "Edit a workout",
      description:
        "Correct session-level fields of a logged workout: title, date/time, sessionRpe, duration (unit-tagged), avgHr, maxHr, calories, notes. " +
        "Get the id from get_recent_workouts (session.id) or get_daily_summary (recentWorkouts[].sessionId). " +
        "This does NOT edit blocks, movements, or sets — to fix reps or weights, delete the workout and re-log it. " +
        EDIT_SCOPE_NOTE,
      inputSchema: updateWorkoutShape,
    },
    async (input) => {
      try {
        return ok(await run((db, c) => updateWorkout(db, c, input)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "delete_workout",
    {
      title: "Delete a workout",
      description:
        "Delete a logged workout session and all its blocks, movements, and sets. " +
        "Get the id from get_recent_workouts (session.id) or get_daily_summary (recentWorkouts[].sessionId). " +
        "Confirm with the user before calling — this is destructive. " +
        EDIT_SCOPE_NOTE,
      inputSchema: deleteWorkoutShape,
    },
    async ({ sessionId }) => {
      try {
        return ok(await run((db, c) => deleteWorkout(db, c, sessionId)));
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
    "get_lab_history",
    {
      title: "Get lab history",
      description:
        "Every recorded value for one analyte over time (oldest first), with units, flags, and reference bounds. " +
        "Use the canonical name (e.g. 'ldl_cholesterol'); see the corpus://analytes resource.",
      inputSchema: { analyte: z.string().min(1).describe("Canonical analyte, e.g. 'ldl_cholesterol'") },
    },
    async ({ analyte }) => {
      try {
        return ok(await run((db, c) => getLabHistory(db, c, analyte)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "get_movement_history",
    {
      title: "Get movement history",
      description:
        "Per-set history for a named movement (oldest first), so you can answer questions like " +
        "'what weight did I use for pause front squats last week?' or 'am I progressing on bench press?'. " +
        "Returns each session it appeared in with the full set list: reps, load (kg + lb), RPE, warmup/failure flags. " +
        "Use before planning a session to check recent loads, or after a session to verify what was logged. " +
        "Movement names are matched flexibly (normalized, plural-insensitive, alias-aware).",
      inputSchema: getMovementHistoryShape,
    },
    async ({ movement, days }) => {
      try {
        return ok(await run((db, c) => getMovementHistory(db, c, movement, days ?? 90)));
      } catch (e) {
        return err(e);
      }
    },
  );

  // --- labs, tests & documents (Phase 2) ------------------------------------

  server.registerTool(
    "record_lab_panel",
    {
      title: "Record lab panel",
      description:
        "Record a blood/urine lab panel and its results, extracted from a report. Provide each result's value VERBATIM " +
        "as printed ('168', '<10', 'NEGATIVE') — the server parses number/comparator and canonicalizes analyte names " +
        "(map to canonical snake_case when you can; see corpus://analytes). Idempotent: re-importing the same panel " +
        "(matched by accession number, else source+date+lab) updates rather than duplicates, and reports any changed values.",
      inputSchema: recordLabPanelShape,
    },
    async (input) => {
      try {
        return ok(await run((db, c) => recordLabPanel(db, c, input)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "record_fitness_test",
    {
      title: "Record fitness test",
      description:
        "Record a VO2 max, RMR, or DEXA result. Put the headline number in primaryValue; test-type-specific detail in " +
        "results (see corpus://schema for the shape per type). For DEXA, also pass bodyComposition — it fans out to body " +
        "measurements and per-region detail on the same timeline as weigh-ins. Idempotent by (test type, date). " +
        "Mass fields are unit-tagged; the server converts.",
      inputSchema: recordFitnessTestShape,
    },
    async (input) => {
      try {
        return ok(await run((db, c) => recordFitnessTest(db, c, input)));
      } catch (e) {
        return err(e);
      }
    },
  );

  server.registerTool(
    "create_document_upload",
    {
      title: "Create document upload",
      description:
        "OPTIONAL — keep the original file (lab PDF, DEXA report, meal photo) alongside the extracted data. Creates a " +
        "document record and returns a one-time upload command; pass the returned documentId to record_lab_panel / " +
        "record_fitness_test to link them. The user runs the upload from their computer. Skip this if they don't want " +
        "to archive the original; the extracted data stands on its own.",
      inputSchema: createDocumentUploadShape,
    },
    async (input) => {
      try {
        const c = ctx();
        const doc = await withUserDb(env, c.userId, (db) => createDocument(db, c, input));
        const token = await issueUploadToken(env, {
          documentId: doc.id,
          userId: c.userId,
          r2Key: doc.r2Key,
          contentType: input.contentType,
        });
        const url = uploadUrlFor(env, token);
        const expiresMinutes = Math.round(UPLOAD_TTL_SECONDS / 60);
        return ok({
          documentId: doc.id,
          filename: doc.filename,
          ...(url
            ? {
                uploadUrl: url,
                expiresInMinutes: expiresMinutes,
                uploadCommand: `curl -X PUT --data-binary @"${input.filename}" -H "Content-Type: ${input.contentType}" "${url}"`,
                instructions:
                  `Run the uploadCommand from the folder containing the file within ${expiresMinutes} minutes. ` +
                  "Then pass documentId to record_lab_panel or record_fitness_test to link the original.",
              }
            : {
                note:
                  "PUBLIC_BASE_URL is not set on the worker, so no upload URL could be generated. " +
                  "The document record was created and can still be linked, but the original file cannot be uploaded " +
                  "until PUBLIC_BASE_URL is configured (see docs/SETUP.md).",
              }),
        });
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

  server.registerResource(
    "analytes",
    "corpus://analytes",
    {
      title: "Canonical analyte dictionary",
      description:
        "Canonical snake_case analyte names, categories, and preferred units for record_lab_panel and get_lab_history. " +
        "Map printed lab names to these; analytes not listed here are still accepted.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const byCategory = new Map<string, string[]>();
      for (const a of ANALYTES) {
        const line = `- \`${a.canonical}\` — ${a.display}${a.unit ? ` (${a.unit})` : ""}`;
        const list = byCategory.get(a.category) ?? [];
        list.push(line);
        byCategory.set(a.category, list);
      }
      let text = "# Canonical analytes\n\nMap printed lab names to these canonical keys.\n";
      for (const [category, lines] of byCategory) {
        text += `\n## ${category}\n${lines.join("\n")}\n`;
      }
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  server.registerResource(
    "profile",
    "corpus://profile",
    {
      title: "User profile",
      description:
        "Who the user is and what they're working toward: display name, timezone, unit preference, and the " +
        "active-goals digest ordered by priority. Read this to prime any conversation with context.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const goals = await run((db, c) => getActiveGoals(db, c));
      const text = renderProfile(getProps(), goals);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );
}
