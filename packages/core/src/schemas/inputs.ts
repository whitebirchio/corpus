/**
 * Zod input schemas for MCP tools (specs/01-initial-platform/SPEC.md §6.1). Defined in core so the MCP
 * server, importers, and tests all validate identically.
 *
 * Every quantity that has a unit arrives unit-tagged ({ value, unit }) and is
 * converted server-side (units.ts). Dates are YYYY-MM-DD in the user's
 * timezone; times are HH:MM local. `allowDuplicate` opts out of soft-dedup
 * after the agent has confirmed with the user (specs/01-initial-platform/SPEC.md §5.9 tier 3).
 */
import { z } from "zod";

// --- unit-tagged values ----------------------------------------------------

export const massValue = z
  .object({
    value: z.number().positive(),
    unit: z.enum(["kg", "lb", "g", "oz"]),
  })
  .describe("Unit-tagged mass, e.g. { value: 185, unit: 'lb' }");

export const distanceValue = z
  .object({
    value: z.number().positive(),
    unit: z.enum(["m", "km", "mi", "ft", "yd"]),
  })
  .describe("Unit-tagged distance, e.g. { value: 5, unit: 'mi' }");

export const durationValue = z
  .object({
    value: z.number().positive(),
    unit: z.enum(["s", "min", "h"]),
  })
  .describe("Unit-tagged duration, e.g. { value: 45, unit: 'min' }");

export const localDate = z.iso
  .date()
  .describe("Calendar date YYYY-MM-DD in the user's timezone");

export const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM 24h")
  .describe("Wall-clock time HH:MM in the user's timezone");

// --- daily check-in (§8.1) ---------------------------------------------------

export const logDailyCheckinShape = {
  date: localDate.optional().describe("Defaults to today"),
  sleepDuration: durationValue.optional(),
  sleepScore: z.number().int().min(0).max(100).optional().describe("Garmin sleep score"),
  sleepQuality: z.number().int().min(1).max(5).optional().describe("Subjective 1-5"),
  // Garmin sleep-stage breakdown — usually import-only, but accepted if reported.
  sleepDeep: durationValue.optional().describe("Deep sleep"),
  sleepLight: durationValue.optional().describe("Light sleep"),
  sleepRem: durationValue.optional().describe("REM sleep"),
  sleepAwake: durationValue.optional().describe("Time awake"),
  hrvMs: z.number().positive().optional().describe("Overnight HRV in ms"),
  restingHr: z.number().int().positive().optional(),
  steps: z.number().int().nonnegative().optional().describe("Usually yesterday's total"),
  bodyBattery: z.number().int().min(0).max(100).optional().describe("Day's highest Body Battery"),
  bodyBatteryLow: z.number().int().min(0).max(100).optional().describe("Day's lowest Body Battery"),
  stressScore: z.number().int().min(0).max(100).optional(),
  respirationAvg: z.number().positive().optional().describe("Avg waking breaths/min"),
  spo2Avg: z.number().int().min(50).max(100).optional().describe("Avg overnight pulse ox %"),
  activeKcal: z.number().int().nonnegative().optional().describe("Active energy burned"),
  bmrKcal: z.number().int().nonnegative().optional().describe("Resting (BMR) energy burned"),
  intensityMinutesModerate: z.number().int().nonnegative().optional(),
  intensityMinutesVigorous: z.number().int().nonnegative().optional(),
  trainingReadiness: z.number().int().min(0).max(100).optional().describe("Garmin readiness score"),
  vo2max: z.number().positive().optional().describe("Watch-estimated VO2 max"),
  energy: z.number().int().min(1).max(5).optional().describe("Subjective energy 1-5"),
  weight: massValue.optional().describe("Morning weigh-in, if taken"),
  bodyFatPct: z.number().min(1).max(75).optional().describe("Scale body-fat %, if shown"),
  sorenessNotes: z.string().optional(),
  notes: z.string().optional(),
};
export const logDailyCheckinInput = z.object(logDailyCheckinShape);
export type LogDailyCheckinInput = z.infer<typeof logDailyCheckinInput>;

// --- workouts (§5.3) ---------------------------------------------------------

export const strengthSetInput = z.object({
  reps: z.number().int().nonnegative().optional(),
  load: massValue.optional(),
  rpe: z.number().min(1).max(10).optional(),
  isWarmup: z.boolean().optional(),
  isFailure: z.boolean().optional(),
  notes: z.string().optional(),
});

export const blockMovementInput = z.object({
  name: z.string().min(1).describe("Movement name, e.g. 'back squat', 'thruster'"),
  category: z
    .enum(["squat", "hinge", "press", "pull", "carry", "olympic", "core", "monostructural", "plyo", "other"])
    .optional()
    .describe("Only needed when the movement is new to the catalog"),
  primaryMuscles: z
    .array(z.string())
    .optional()
    .describe("Only needed when the movement is new to the catalog"),
  prescription: z
    .string()
    .optional()
    .describe("Verbatim scheme as a fallback, e.g. '5x5 @ 185', '21-15-9'. Prefer structured `sets` when reps/loads are known."),
  sets: z
    .array(strengthSetInput)
    .optional()
    .describe(
      "REQUIRED for any movement performed as sets — strength AND weighted accessories. One entry per set with reps + load (unit-tagged). " +
        "e.g. 3x10 at 20lb dumbbells => three sets each { reps: 10, load: { value: 20, unit: 'lb' } }. Bodyweight sets omit load.",
    ),
  repsPerRound: z.number().int().positive().optional().describe("METCON ONLY: reps per round"),
  load: massValue.optional().describe("METCON ONLY: working load per round. For set-based work use `sets`, not this."),
  distancePerRound: distanceValue.optional().describe("METCON ONLY: distance per round"),
});

export const workoutBlockInput = z.object({
  type: z.enum(["strength", "run", "metcon", "interval", "warmup", "cooldown", "mobility", "other"]),
  // metcon structure
  scheme: z
    .enum(["amrap", "emom", "for_time", "rounds_for_time", "tabata", "chipper", "ladder", "custom"])
    .optional(),
  roundsPlanned: z.number().int().positive().optional(),
  timeCap: durationValue.optional(),
  interval: durationValue.optional().describe("EMOM/interval length"),
  // metcon result
  resultTime: durationValue.optional().describe("Finish time (for-time schemes)"),
  resultRounds: z.number().int().nonnegative().optional().describe("Completed rounds (AMRAP)"),
  resultReps: z.number().int().nonnegative().optional().describe("Extra reps beyond full rounds"),
  rx: z.boolean().optional().describe("Performed as prescribed"),
  // cardio detail
  distance: distanceValue.optional(),
  duration: durationValue.optional(),
  pace: z
    .object({ value: z.number().positive(), unit: z.enum(["min/km", "min/mi"]) })
    .optional()
    .describe("Average pace; derived from distance+duration when omitted"),
  avgHr: z.number().int().positive().optional(),
  maxHr: z.number().int().positive().optional(),
  elevationGain: distanceValue.optional(),
  splits: z.array(z.record(z.string(), z.unknown())).optional(),
  rpe: z.number().min(1).max(10).optional(),
  notes: z.string().optional(),
  movements: z.array(blockMovementInput).optional(),
});

export const logWorkoutShape = {
  date: localDate.optional().describe("Defaults to today"),
  time: localTime.optional().describe("Start time; defaults to now"),
  title: z.string().optional().describe("e.g. 'Upper push + easy run'"),
  duration: durationValue.optional().describe("Total session duration"),
  sessionRpe: z.number().min(1).max(10).optional(),
  avgHr: z.number().int().positive().optional(),
  maxHr: z.number().int().positive().optional(),
  calories: z.number().int().positive().optional(),
  notes: z.string().optional(),
  blocks: z.array(workoutBlockInput).min(1),
  allowDuplicate: z
    .boolean()
    .optional()
    .describe("Set true ONLY after the user confirms a near-duplicate is intentional"),
  allowIncomplete: z
    .boolean()
    .optional()
    .describe(
      "Set true ONLY after confirming with the user that a strength/metcon movement genuinely has no reps/weight to record. " +
        "Otherwise leave unset so the tool can catch dropped set data.",
    ),
};
export const logWorkoutInput = z.object(logWorkoutShape);
export type LogWorkoutInput = z.infer<typeof logWorkoutInput>;

// --- meals (§5.4) ------------------------------------------------------------

export const mealItemInput = z.object({
  name: z.string().min(1),
  quantity: z.number().positive().optional(),
  unitNote: z.string().optional().describe("Verbatim portion, e.g. '1 cup', '6 oz'"),
  calories: z.number().nonnegative().optional(),
  proteinG: z.number().nonnegative().optional(),
  carbsG: z.number().nonnegative().optional(),
  fatG: z.number().nonnegative().optional(),
  micros: z
    .record(z.string(), z.number())
    .optional()
    .describe("fiber_g, sugar_g, sat_fat_g, sodium_mg, cholesterol_mg, potassium_mg, ..."),
  confidence: z.enum(["high", "medium", "low"]).optional(),
});

export const logMealShape = {
  date: localDate.optional().describe("Defaults to today"),
  time: localTime.optional().describe("Defaults to a nominal time for the meal type"),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  description: z.string().min(1).describe("Short human description of the meal"),
  items: z
    .array(mealItemInput)
    .optional()
    .describe("Itemized breakdown when inferable; totals computed from items"),
  totals: z
    .object({
      calories: z.number().nonnegative(),
      proteinG: z.number().nonnegative(),
      carbsG: z.number().nonnegative(),
      fatG: z.number().nonnegative(),
    })
    .optional()
    .describe("Direct totals when not itemizing (e.g. MacroFactor numbers)"),
  photoDocumentId: z.uuid().optional(),
  notes: z.string().optional(),
  allowDuplicate: z
    .boolean()
    .optional()
    .describe("Set true ONLY after the user confirms a near-duplicate is intentional"),
};
export const logMealInput = z
  .object(logMealShape)
  .refine((m) => (m.items?.length ?? 0) > 0 || m.totals, {
    message: "Provide items or totals",
  });
export type LogMealInput = z.infer<typeof logMealInput>;

export const setNutritionTargetsShape = {
  effectiveDate: localDate.optional().describe("Defaults to today"),
  calories: z.number().int().positive(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
  fiberG: z.number().nonnegative().optional(),
  notes: z.string().optional(),
};
export const setNutritionTargetsInput = z.object(setNutritionTargetsShape);
export type SetNutritionTargetsInput = z.infer<typeof setNutritionTargetsInput>;

// --- observations (§5.8) -----------------------------------------------------

export const logObservationShape = {
  date: localDate.optional(),
  time: localTime.optional(),
  kind: z.enum(["energy", "mood", "soreness", "symptom", "note"]),
  value: z.number().int().min(1).max(5).optional().describe("Intensity 1-5 where applicable"),
  bodyArea: z.string().optional().describe("For soreness/symptoms, e.g. 'left knee'"),
  text: z.string().min(1),
};
export const logObservationInput = z.object(logObservationShape);
export type LogObservationInput = z.infer<typeof logObservationInput>;

// --- regimen (§5.5) ----------------------------------------------------------

export const upsertRegimenItemShape = {
  name: z.string().min(1),
  type: z.enum(["medication", "supplement"]),
  doseAmount: z.number().positive().optional(),
  doseUnit: z.string().optional().describe("mg, mcg, IU, g, ..."),
  scheduleText: z.string().optional().describe("Verbatim: '1x daily, morning, with food'"),
  timesPerDay: z.number().int().positive().optional(),
  timing: z.array(z.string()).optional().describe("e.g. ['morning', 'with food']"),
  purpose: z.string().optional().describe("Why it's taken — feeds analysis context"),
  prescriber: z.string().optional(),
  startedOn: localDate.optional().describe("Defaults to today"),
  notes: z.string().optional(),
};
export const upsertRegimenItemInput = z.object(upsertRegimenItemShape);
export type UpsertRegimenItemInput = z.infer<typeof upsertRegimenItemInput>;

export const endRegimenItemShape = {
  name: z.string().min(1),
  endedOn: localDate.optional().describe("Defaults to today"),
  reason: z.string().optional(),
};
export const endRegimenItemInput = z.object(endRegimenItemShape);
export type EndRegimenItemInput = z.infer<typeof endRegimenItemInput>;

export const logRegimenEventShape = {
  name: z.string().min(1).describe("Regimen item name (active item)"),
  date: localDate.optional().describe("Defaults to today"),
  eventType: z.enum(["skipped", "extra_dose", "dose_changed", "paused", "resumed"]),
  notes: z.string().optional(),
};
export const logRegimenEventInput = z.object(logRegimenEventShape);
export type LogRegimenEventInput = z.infer<typeof logRegimenEventInput>;

// --- goals & insights (§5.7) ---------------------------------------------------

export const upsertGoalShape = {
  id: z.uuid().optional().describe("Provide to update an existing goal"),
  title: z.string().min(1),
  domain: z.enum(["fitness", "nutrition", "body_comp", "labs", "lifestyle"]),
  description: z.string().optional(),
  priority: z.number().int().min(1).optional().describe("Lower = more important"),
  target: z
    .object({
      metric: z.string().optional(),
      targetValue: z.number().optional(),
      unit: z.string().optional(),
      direction: z.enum(["increase", "decrease", "maintain"]).optional(),
    })
    .optional(),
  targetDate: localDate.optional(),
  notes: z.string().optional(),
};
export const upsertGoalInput = z.object(upsertGoalShape);
export type UpsertGoalInput = z.infer<typeof upsertGoalInput>;

export const updateGoalStatusShape = {
  id: z.uuid(),
  status: z.enum(["active", "paused", "achieved", "abandoned"]),
  notes: z.string().optional(),
};
export const updateGoalStatusInput = z.object(updateGoalStatusShape);
export type UpdateGoalStatusInput = z.infer<typeof updateGoalStatusInput>;

export const saveInsightShape = {
  title: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string()).optional(),
};
export const saveInsightInput = z.object(saveInsightShape);
export type SaveInsightInput = z.infer<typeof saveInsightInput>;

// --- reads -------------------------------------------------------------------

export const getDailySummaryShape = {
  date: localDate.optional().describe("Defaults to today"),
};

export const queryDataShape = {
  sql: z
    .string()
    .min(1)
    .describe(
      "A single read-only SELECT (or WITH...SELECT) statement. " +
        "Consult the corpus://schema resource for tables and semantics.",
    ),
};

export const getRecentWorkoutsShape = {
  days: z.number().int().min(1).max(90).optional().describe("Lookback window, default 10"),
};

export const getLabHistoryShape = {
  analyte: z.string().min(1).describe("Canonical analyte name, e.g. 'ldl_cholesterol'"),
};

export const getMovementHistoryShape = {
  movement: z
    .string()
    .min(1)
    .describe("Movement name as logged, e.g. 'pause front squat', 'bench press'"),
  days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe("Lookback window in days (default 90)"),
};
