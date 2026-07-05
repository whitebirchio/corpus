/**
 * Zod input schemas for the training-plan MCP tools (specs/04-training-plans/SPEC.md §4).
 * Same conventions as inputs.ts: unit-tagged quantities converted server-side,
 * dates YYYY-MM-DD in the user's timezone, structured result unions from repos.
 */
import { z } from "zod";
import { distanceValue, durationValue, localDate, massValue } from "./inputs.js";

// --- plan changes (§3.3) -----------------------------------------------------

export const planChangeInput = z.object({
  category: z.enum([
    "sickness",
    "injury",
    "weather",
    "schedule",
    "fatigue",
    "equipment",
    "preference",
    "progression",
    "other",
  ]),
  summary: z
    .string()
    .min(1)
    .describe("What changed and why, quoting the user's stated reason where possible"),
});
export type PlanChangeInput = z.infer<typeof planChangeInput>;

// --- planned week (§3.2) -----------------------------------------------------

export const plannedMovementInput = z.object({
  name: z.string().min(1).describe("Movement name, e.g. 'back squat' — resolved against the catalog"),
  category: z
    .enum(["squat", "hinge", "press", "pull", "carry", "olympic", "core", "monostructural", "plyo", "other"])
    .optional()
    .describe("Only needed when the movement is new to the catalog"),
  primaryMuscles: z
    .array(z.string())
    .optional()
    .describe("Only needed when the movement is new to the catalog"),
  sets: z.number().int().positive().optional(),
  reps: z.number().int().positive().optional().describe("Reps per set when uniform"),
  repsText: z
    .string()
    .optional()
    .describe("Irregular scheme when a single reps number can't express it: '8-10', '21-15-9', 'AMRAP'"),
  targetLoad: massValue.optional().describe("Prescribed working load, unit-tagged"),
  targetRpe: z.number().min(1).max(10).optional(),
  rest: durationValue.optional().describe("Rest between sets"),
  prescription: z
    .string()
    .optional()
    .describe("Display text, e.g. '4×8 @ 135 lb'. Prefer the structured fields; comparisons use the numbers."),
  notes: z.string().optional(),
});

export const plannedBlockInput = z.object({
  type: z.enum(["strength", "run", "metcon", "interval", "warmup", "cooldown", "mobility", "other"]),
  // metcon prescription
  scheme: z
    .enum(["amrap", "emom", "for_time", "rounds_for_time", "tabata", "chipper", "ladder", "custom"])
    .optional(),
  roundsPlanned: z.number().int().positive().optional(),
  timeCap: durationValue.optional(),
  interval: durationValue.optional().describe("EMOM/interval length"),
  // cardio prescription
  targetDistance: distanceValue.optional(),
  targetDuration: durationValue.optional(),
  targetPace: z
    .object({ value: z.number().positive(), unit: z.enum(["min/km", "min/mi"]) })
    .optional(),
  structure: z
    .string()
    .optional()
    .describe("Interval/session structure, e.g. '5 × 3:00 @ RPE 6 / 2:00 jog'"),
  targetRpe: z.number().min(1).max(10).optional(),
  notes: z.string().optional(),
  movements: z.array(plannedMovementInput).optional(),
});

export const plannedSessionInput = z.object({
  date: localDate,
  title: z.string().min(1).describe("e.g. 'Lower strength', 'Long run 10 mi'"),
  notes: z.string().optional(),
  blocks: z.array(plannedBlockInput).min(1),
});
export type PlannedSessionInput = z.infer<typeof plannedSessionInput>;

export const planWeekShape = {
  weekStart: localDate.describe("The MONDAY the week starts on"),
  focus: z
    .string()
    .optional()
    .describe("Current training emphasis, e.g. 'aerobic base + maintain strength'"),
  notes: z.string().optional(),
  sessions: z.array(plannedSessionInput).min(1).describe("At most one session per day"),
  change: planChangeInput
    .optional()
    .describe("REQUIRED when re-planning a week that already has sessions"),
};
export const planWeekInput = z.object(planWeekShape);
export type PlanWeekInput = z.infer<typeof planWeekInput>;

export const updatePlannedSessionShape = {
  plannedSessionId: z.uuid().describe("id from get_training_plan"),
  change: planChangeInput.describe("Why this session is changing — always required"),
  date: localDate.optional().describe("Move the session to another day in the same week"),
  title: z.string().optional(),
  notes: z.string().optional(),
  status: z
    .enum(["planned", "skipped", "cancelled"])
    .optional()
    .describe(
      "skipped = didn't happen (counts against adherence); cancelled = deliberately removed ahead of time; " +
        "planned = undo a mistaken skip/cancel",
    ),
  blocks: z
    .array(plannedBlockInput)
    .min(1)
    .optional()
    .describe("If provided, REPLACES the session's entire prescription"),
};
export const updatePlannedSessionInput = z.object(updatePlannedSessionShape);
export type UpdatePlannedSessionInput = z.infer<typeof updatePlannedSessionInput>;

export const linkWorkoutToPlanShape = {
  sessionId: z.uuid().describe("Logged workout session.id (get_recent_workouts / get_daily_summary)"),
  plannedSessionId: z
    .uuid()
    .optional()
    .describe("Planned session id from get_training_plan; required unless unlinking"),
  unlink: z.boolean().optional().describe("Remove the workout's existing plan link instead"),
};
export const linkWorkoutToPlanInput = z.object(linkWorkoutToPlanShape);
export type LinkWorkoutToPlanInput = z.infer<typeof linkWorkoutToPlanInput>;

export const getTrainingPlanShape = {
  weekStart: localDate.optional().describe("A Monday; defaults to the current week"),
};

// --- milestones (§3.1) ---------------------------------------------------------

export const upsertMilestoneShape = {
  id: z.uuid().optional().describe("Provide to update an existing milestone"),
  goalId: z.uuid().describe("Parent goal id from get_goals"),
  title: z.string().min(1),
  description: z.string().optional(),
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
export const upsertMilestoneInput = z.object(upsertMilestoneShape);
export type UpsertMilestoneInput = z.infer<typeof upsertMilestoneInput>;

export const updateMilestoneStatusShape = {
  id: z.uuid(),
  status: z.enum(["active", "paused", "achieved", "abandoned"]),
  notes: z.string().optional(),
};
export const updateMilestoneStatusInput = z.object(updateMilestoneStatusShape);
export type UpdateMilestoneStatusInput = z.infer<typeof updateMilestoneStatusInput>;

// --- athlete model (§3.4) ------------------------------------------------------

export const upsertEquipmentItemShape = {
  id: z.uuid().optional().describe("Provide to update an existing item"),
  name: z
    .string()
    .min(1)
    .describe(
      "e.g. 'barbell', 'adjustable dumbbells', 'treadmill' — align with the movement catalog's equipment vocabulary where possible",
    ),
  category: z.enum([
    "barbell",
    "dumbbell",
    "kettlebell",
    "rack",
    "bench",
    "band",
    "machine",
    "cardio",
    "other",
  ]),
  details: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Free-form specifics: { maxLoadKg, incrementKg, count, resistanceLevels, ... }"),
  location: z.string().optional().describe("'garage', 'gym', ..."),
  active: z.boolean().optional().describe("false retires the item (kept for history)"),
  notes: z.string().optional(),
};
export const upsertEquipmentItemInput = z.object(upsertEquipmentItemShape);
export type UpsertEquipmentItemInput = z.infer<typeof upsertEquipmentItemInput>;

/** Unit-tagged capability value; converted to canonical (kg, m, s, s/km, m/week). */
export const capabilityValue = z.object({
  value: z.number().positive(),
  unit: z.enum(["kg", "lb", "m", "km", "mi", "min/km", "min/mi", "s", "min", "h", "km/week", "mi/week"]),
});

export const upsertCapabilityEstimateShape = {
  movement: z
    .string()
    .optional()
    .describe("Movement name for per-movement strength metrics; omit for movement-less capacities"),
  metric: z
    .string()
    .min(1)
    .describe(
      "Per-movement: 'working_load' (with repMax) or 'e1rm'. Movement-less: 'weekly_run_volume', 'long_run_distance', 'zone2_pace', 'threshold_pace', ...",
    ),
  repMax: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("N when the value is an N-rep working estimate, e.g. 5 for a 5RM working load"),
  estimate: capabilityValue,
  confidence: z.enum(["high", "medium", "low"]).optional().describe("Defaults to medium"),
  basis: z
    .string()
    .min(1)
    .describe("Evidence citation, e.g. '5×5 @ 84 kg on 2026-07-01, RPE 7' — never save an estimate without one"),
  effectiveDate: localDate.optional().describe("Defaults to today"),
};
export const upsertCapabilityEstimateInput = z.object(upsertCapabilityEstimateShape);
export type UpsertCapabilityEstimateInput = z.infer<typeof upsertCapabilityEstimateInput>;

export const upsertPlanningConstraintShape = {
  id: z.uuid().optional().describe("Provide to update an existing constraint"),
  kind: z.enum(["schedule", "injury", "seasonal", "equipment_access", "preference", "other"]),
  rule: z
    .string()
    .min(1)
    .describe("The standing rule, e.g. 'No outdoor runs below about -12C — treadmill instead'"),
  params: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional().describe("false retires the constraint (e.g. injury cleared)"),
  notes: z.string().optional(),
};
export const upsertPlanningConstraintInput = z.object(upsertPlanningConstraintShape);
export type UpsertPlanningConstraintInput = z.infer<typeof upsertPlanningConstraintInput>;
