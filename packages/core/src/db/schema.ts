/**
 * Corpus data model — see specs/01-initial-platform/SPEC.md §5.
 *
 * Conventions:
 * - Column property names are camelCase; the DB uses snake_case via drizzle's
 *   `casing: "snake_case"` option (must be set in BOTH drizzle.config.ts and
 *   every runtime drizzle() call).
 * - Canonical metric units in storage: kg, meters, seconds, kcal. Conversion
 *   happens server-side in core/units.ts — never in the LLM.
 * - `user_id` is denormalized onto child tables (blocks, sets, items, results)
 *   so every RLS policy is the same single-column check and query_data SQL
 *   stays simple.
 * - RLS: every user-owned table carries a policy comparing user_id to the
 *   `app.user_id` session setting. The movements catalog is global (no RLS).
 * - IDs are UUIDv4 via gen_random_uuid(): v7 would need PG18 or an extension,
 *   and created_at already covers ordering needs.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const unitPreference = pgEnum("unit_preference", ["imperial", "metric"]);

export const dataSource = pgEnum("data_source", [
  "checkin",
  "conversation",
  "garmin_export",
  "macrofactor_export",
  "document_extraction",
  "manual",
]);

export const blockType = pgEnum("block_type", [
  "strength",
  "run",
  "metcon",
  "interval",
  "warmup",
  "cooldown",
  "mobility",
  "other",
]);

export const metconScheme = pgEnum("metcon_scheme", [
  "amrap",
  "emom",
  "for_time",
  "rounds_for_time",
  "tabata",
  "chipper",
  "ladder",
  "custom",
]);

export const movementCategory = pgEnum("movement_category", [
  "squat",
  "hinge",
  "press",
  "pull",
  "carry",
  "olympic",
  "core",
  "monostructural",
  "plyo",
  "other",
]);

export const mealType = pgEnum("meal_type", ["breakfast", "lunch", "dinner", "snack"]);

export const mealGranularity = pgEnum("meal_granularity", ["itemized", "totals"]);

export const estimateConfidence = pgEnum("estimate_confidence", ["high", "medium", "low"]);

export const regimenType = pgEnum("regimen_type", ["medication", "supplement"]);

export const regimenEventType = pgEnum("regimen_event_type", [
  "skipped",
  "extra_dose",
  "dose_changed",
  "paused",
  "resumed",
]);

export const documentKind = pgEnum("document_kind", [
  "lab_report",
  "dexa_report",
  "fitness_test",
  "meal_photo",
  "export",
  "screenshot",
  "other",
]);

export const extractionStatus = pgEnum("extraction_status", [
  "pending",
  "extracted",
  "verified",
  "failed",
]);

export const labSource = pgEnum("lab_source", ["function_health", "pcp", "dexafit", "other"]);

export const labCategory = pgEnum("lab_category", [
  "lipids",
  "cardio_advanced",
  "metabolic",
  "cbc",
  "hormones",
  "thyroid",
  "vitamins_minerals",
  "inflammation",
  "autoimmune",
  "urinalysis",
  "heavy_metals",
  "other",
]);

export const valueComparator = pgEnum("value_comparator", ["eq", "lt", "gt", "le", "ge"]);

export const labFlag = pgEnum("lab_flag", ["normal", "low", "high", "critical", "abnormal"]);

export const fitnessTestType = pgEnum("fitness_test_type", ["vo2max", "rmr", "dexa", "other"]);

export const bodyRegion = pgEnum("body_region", [
  "total",
  "arm",
  "leg",
  "trunk",
  "head",
  "ribs",
  "spine",
  "pelvis",
  "android",
  "gynoid",
]);

export const bodySide = pgEnum("body_side", ["left", "right", "both"]);

export const goalDomain = pgEnum("goal_domain", [
  "fitness",
  "nutrition",
  "body_comp",
  "labs",
  "lifestyle",
]);

export const goalStatus = pgEnum("goal_status", ["active", "paused", "achieved", "abandoned"]);

export const insightStatus = pgEnum("insight_status", ["active", "archived"]);

export const insightSource = pgEnum("insight_source", ["agent", "user"]);

export const observationKind = pgEnum("observation_kind", [
  "energy",
  "mood",
  "soreness",
  "symptom",
  "note",
]);

export const plannedSessionStatus = pgEnum("planned_session_status", [
  "planned",
  "completed", // set when a logged workout is linked
  "skipped", // didn't happen, decided after the fact — counts against adherence
  "cancelled", // removed ahead of time by a deliberate re-plan — doesn't
]);

export const planChangeCategory = pgEnum("plan_change_category", [
  "sickness",
  "injury",
  "weather",
  "schedule",
  "fatigue",
  "equipment",
  "preference",
  "progression",
  "other",
]);

export const equipmentCategory = pgEnum("equipment_category", [
  "barbell",
  "dumbbell",
  "kettlebell",
  "rack",
  "bench",
  "band",
  "machine",
  "cardio",
  "other",
]);

export const constraintKind = pgEnum("constraint_kind", [
  "schedule",
  "injury",
  "seasonal",
  "equipment_access",
  "preference",
  "other",
]);

// ---------------------------------------------------------------------------
// Shared column helpers
// ---------------------------------------------------------------------------

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** The standard RLS policy: rows are visible/writable only by their owner. */
const ownerPolicy = (table: { userId: AnyPgColumn }) =>
  pgPolicy("owner_only", {
    for: "all",
    using: sql`${table.userId} = (select current_setting('app.user_id', true)::uuid)`,
    withCheck: sql`${table.userId} = (select current_setting('app.user_id', true)::uuid)`,
  });

// ---------------------------------------------------------------------------
// 5.1 Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text().notNull(),
    displayName: text().notNull(),
    timezone: text().notNull().default("America/New_York"),
    unitPreference: unitPreference().notNull().default("imperial"),
    // Where to check the weather when planning training (specs/04-training-plans/SPEC.md decision #9).
    homeLocation: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    // Self-access via app.user_id; the OAuth callback (no user yet) reaches
    // its row via app.auth_email set from the verified, allowlisted Google
    // email. Both settings NULL → no rows.
    pgPolicy("users_self", {
      for: "all",
      using: sql`${t.id} = (select current_setting('app.user_id', true)::uuid)
        or ${t.email} = (select current_setting('app.auth_email', true))`,
      withCheck: sql`${t.id} = (select current_setting('app.user_id', true)::uuid)
        or ${t.email} = (select current_setting('app.auth_email', true))`,
    }),
  ],
);

// ---------------------------------------------------------------------------
// 5.2 Biometrics & body composition
// ---------------------------------------------------------------------------

export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date().notNull(),
    source: dataSource().notNull().default("checkin"),
    sleepDurationS: integer(),
    sleepScore: integer(),
    sleepQualitySubjective: integer(), // 1-5
    // Garmin sleep-stage breakdown (seconds); sum ≈ sleep_duration_s + awake.
    sleepDeepS: integer(),
    sleepLightS: integer(),
    sleepRemS: integer(),
    sleepAwakeS: integer(),
    hrvMs: doublePrecision(),
    restingHr: integer(),
    steps: integer(),
    bodyBattery: integer(), // day's highest Body Battery
    bodyBatteryLow: integer(), // day's lowest — the drain tells the recovery story
    stressScore: integer(),
    respirationAvg: doublePrecision(), // avg waking breaths/min
    spo2Avg: integer(), // avg overnight pulse ox %
    // Garmin energy expenditure (kcal): active = movement, bmr = resting.
    activeKcal: integer(),
    bmrKcal: integer(),
    intensityMinutesModerate: integer(),
    intensityMinutesVigorous: integer(),
    trainingReadiness: integer(), // Garmin morning recovery score 0-100
    vo2max: doublePrecision(), // watch-estimated; lab tests live in fitness_tests
    energySubjective: integer(), // 1-5
    sorenessNotes: text(),
    notes: text(),
    extras: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("daily_metrics_user_date_uq").on(t.userId, t.localDate),
    ownerPolicy(t),
  ],
);

export const bodyMeasurements = pgTable(
  "body_measurements",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    measuredAt: timestamp({ withTimezone: true }).notNull(),
    source: dataSource().notNull().default("checkin"),
    documentId: uuid().references(() => documents.id),
    fitnessTestId: uuid().references(() => fitnessTests.id),
    weightKg: doublePrecision(),
    bodyFatPct: doublePrecision(),
    leanMassKg: doublePrecision(),
    fatMassKg: doublePrecision(),
    boneMineralContentKg: doublePrecision(),
    visceralFatKg: doublePrecision(),
    visceralFatRating: doublePrecision(),
    androidGynoidRatio: doublePrecision(),
    almi: doublePrecision(), // appendicular lean mass index, kg/m^2
    ffmi: doublePrecision(), // fat-free mass index, kg/m^2
    bmdTotalGcm2: doublePrecision(),
    bmdTscore: doublePrecision(),
    bmdZscore: doublePrecision(),
    bodyScore: text(), // provider grade, e.g. "C+"
    extras: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("body_measurements_user_time_source_uq").on(t.userId, t.measuredAt, t.source),
    index("body_measurements_user_time_idx").on(t.userId, t.measuredAt),
    ownerPolicy(t),
  ],
);

export const bodyCompositionRegions = pgTable(
  "body_composition_regions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    measurementId: uuid()
      .notNull()
      .references(() => bodyMeasurements.id, { onDelete: "cascade" }),
    region: bodyRegion().notNull(),
    side: bodySide(),
    leanMassKg: doublePrecision(),
    fatMassKg: doublePrecision(),
    fatPct: doublePrecision(),
    bmdGcm2: doublePrecision(),
    bmdPercentile: doublePrecision(),
    createdAt: createdAt(),
  },
  (t) => [
    index("bcr_measurement_idx").on(t.measurementId),
    ownerPolicy(t),
  ],
);

// ---------------------------------------------------------------------------
// 5.3 Workouts
// ---------------------------------------------------------------------------

export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    localDate: date().notNull(),
    title: text(),
    source: dataSource().notNull().default("conversation"),
    sourceRef: text(), // e.g. Garmin activity id — idempotency key for imports
    // Agent-mediated link to the training plan (specs/04-training-plans/SPEC.md
    // decision #6); deleting a plan never deletes the logged workout.
    plannedSessionId: uuid().references((): AnyPgColumn => plannedSessions.id, {
      onDelete: "set null",
    }),
    durationS: integer(),
    sessionRpe: integer(), // 1-10
    avgHr: integer(),
    maxHr: integer(),
    calories: integer(),
    notes: text(),
    extras: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("workout_sessions_source_ref_uq")
      .on(t.userId, t.source, t.sourceRef)
      .where(sql`${t.sourceRef} is not null`),
    index("workout_sessions_user_date_idx").on(t.userId, t.localDate),
    ownerPolicy(t),
  ],
);

export const workoutBlocks = pgTable(
  "workout_blocks",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid()
      .notNull()
      .references(() => workoutSessions.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    blockType: blockType().notNull(),
    // metcon structure
    scheme: metconScheme(),
    roundsPlanned: integer(),
    timeCapS: integer(),
    intervalS: integer(),
    // metcon result
    resultTimeS: integer(),
    resultRounds: integer(),
    resultReps: integer(),
    rx: boolean(),
    // cardio (run/row/bike) detail
    distanceM: doublePrecision(),
    durationS: integer(),
    avgPaceSPerKm: doublePrecision(),
    avgHr: integer(),
    maxHr: integer(),
    elevationGainM: doublePrecision(),
    splits: jsonb().$type<Array<Record<string, unknown>>>(),
    rpe: integer(),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("workout_blocks_session_idx").on(t.sessionId),
    ownerPolicy(t),
  ],
);

/** Global movement catalog — not per-user, no RLS. Seeded; agent may add. */
export const movements = pgTable(
  "movements",
  {
    id: id(),
    name: text().notNull(),
    aliases: text().array().notNull().default([]),
    category: movementCategory().notNull(),
    primaryMuscles: text().array().notNull().default([]),
    secondaryMuscles: text().array().notNull().default([]),
    equipment: text().array().notNull().default([]),
    /** True for seeded rows; false for agent-proposed additions pending review. */
    verified: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("movements_name_uq").on(t.name)],
);

export const blockMovements = pgTable(
  "block_movements",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockId: uuid()
      .notNull()
      .references(() => workoutBlocks.id, { onDelete: "cascade" }),
    movementId: uuid()
      .notNull()
      .references(() => movements.id),
    seq: integer().notNull(),
    prescription: text(), // verbatim, e.g. "5x5 @ 185", "21-15-9"
    repsPerRound: integer(),
    loadKg: doublePrecision(), // metcon load
    distanceMPerRound: doublePrecision(),
    createdAt: createdAt(),
  },
  (t) => [
    index("block_movements_block_idx").on(t.blockId),
    index("block_movements_movement_idx").on(t.movementId),
    ownerPolicy(t),
  ],
);

export const strengthSets = pgTable(
  "strength_sets",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockMovementId: uuid()
      .notNull()
      .references(() => blockMovements.id, { onDelete: "cascade" }),
    setNumber: integer().notNull(),
    reps: integer(),
    loadKg: doublePrecision(),
    rpe: doublePrecision(),
    isWarmup: boolean().notNull().default(false),
    isFailure: boolean().notNull().default(false),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("strength_sets_bm_idx").on(t.blockMovementId),
    ownerPolicy(t),
  ],
);

// ---------------------------------------------------------------------------
// 5.4 Nutrition
// ---------------------------------------------------------------------------

export const nutritionTargets = pgTable(
  "nutrition_targets",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    effectiveDate: date().notNull(),
    calories: integer().notNull(),
    proteinG: doublePrecision().notNull(),
    carbsG: doublePrecision().notNull(),
    fatG: doublePrecision().notNull(),
    fiberG: doublePrecision(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("nutrition_targets_user_date_uq").on(t.userId, t.effectiveDate),
    ownerPolicy(t),
  ],
);

export const meals = pgTable(
  "meals",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eatenAt: timestamp({ withTimezone: true }).notNull(),
    localDate: date().notNull(),
    mealType: mealType().notNull(),
    description: text().notNull(),
    granularity: mealGranularity().notNull(),
    calories: doublePrecision().notNull(),
    proteinG: doublePrecision().notNull(),
    carbsG: doublePrecision().notNull(),
    fatG: doublePrecision().notNull(),
    photoDocumentId: uuid().references(() => documents.id),
    source: dataSource().notNull().default("conversation"),
    sourceRef: text(), // e.g. MacroFactor entry id
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("meals_source_ref_uq")
      .on(t.userId, t.source, t.sourceRef)
      .where(sql`${t.sourceRef} is not null`),
    index("meals_user_date_idx").on(t.userId, t.localDate),
    ownerPolicy(t),
  ],
);

export const mealItems = pgTable(
  "meal_items",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mealId: uuid()
      .notNull()
      .references(() => meals.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    name: text().notNull(),
    quantity: doublePrecision(),
    unitNote: text(), // verbatim, e.g. "1 cup", "6 oz"
    calories: doublePrecision(),
    proteinG: doublePrecision(),
    carbsG: doublePrecision(),
    fatG: doublePrecision(),
    /** fiber_g, sugar_g, sat_fat_g, sodium_mg, cholesterol_mg, potassium_mg, ... */
    micros: jsonb().$type<Record<string, number>>(),
    estimateConfidence: estimateConfidence(),
    // Catalog binding (specs/05-nutrition-accuracy/SPEC.md §4.1): which food this
    // item was resolved against and the grams the server computed macros from.
    foodId: uuid().references(() => foods.id, { onDelete: "set null" }),
    gramsResolved: doublePrecision(),
    createdAt: createdAt(),
  },
  (t) => [
    index("meal_items_meal_idx").on(t.mealId),
    ownerPolicy(t),
  ],
);

// ---------------------------------------------------------------------------
// 5.5 Medications & supplements
// ---------------------------------------------------------------------------

export const regimenItems = pgTable(
  "regimen_items",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    type: regimenType().notNull(),
    doseAmount: doublePrecision(),
    doseUnit: text(), // mg, mcg, IU, g, ...
    scheduleText: text(), // verbatim: "1x daily, morning, with food"
    schedule: jsonb().$type<{ timesPerDay?: number; timing?: string[] }>(),
    purpose: text(),
    prescriber: text(),
    startedOn: date().notNull(),
    endedOn: date(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("regimen_items_user_name_start_uq").on(t.userId, t.name, t.startedOn),
    ownerPolicy(t),
  ],
);

export const regimenEvents = pgTable(
  "regimen_events",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    regimenItemId: uuid()
      .notNull()
      .references(() => regimenItems.id, { onDelete: "cascade" }),
    localDate: date().notNull(),
    eventType: regimenEventType().notNull(),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("regimen_events_item_idx").on(t.regimenItemId),
    ownerPolicy(t),
  ],
);

// ---------------------------------------------------------------------------
// 5.6 Documents, labs & fitness tests
// ---------------------------------------------------------------------------

export const documents = pgTable(
  "documents",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    r2Key: text().notNull(),
    filename: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer(),
    sha256: text(),
    kind: documentKind().notNull(),
    uploadedAt: timestamp({ withTimezone: true }),
    description: text(),
    extractionStatus: extractionStatus().notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("documents_user_sha_uq")
      .on(t.userId, t.sha256)
      .where(sql`${t.sha256} is not null`),
    ownerPolicy(t),
  ],
);

export const labPanels = pgTable(
  "lab_panels",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    collectedOn: date().notNull(),
    reportedOn: date(),
    source: labSource().notNull(),
    labName: text(), // performing lab, e.g. "Quest"
    orderingProvider: text(),
    accessionNumber: text(), // strongest idempotency key when present
    fasting: boolean(),
    documentId: uuid().references(() => documents.id),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("lab_panels_accession_uq")
      .on(t.userId, t.source, t.accessionNumber)
      .where(sql`${t.accessionNumber} is not null`),
    index("lab_panels_user_date_idx").on(t.userId, t.collectedOn),
    ownerPolicy(t),
  ],
);

export const labResults = pgTable(
  "lab_results",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    panelId: uuid()
      .notNull()
      .references(() => labPanels.id, { onDelete: "cascade" }),
    subPanel: text(), // e.g. "Lipid Panel", "CMP", "Urinalysis"
    analyte: text().notNull(), // canonical, e.g. "ldl_cholesterol"
    rawName: text().notNull(), // as printed on the report
    category: labCategory().notNull(),
    valueText: text().notNull(), // verbatim: "168", "<10", "NEGATIVE"
    valueNum: doublePrecision(), // parsed when quantitative
    comparator: valueComparator().notNull().default("eq"),
    unit: text(),
    refLow: doublePrecision(),
    refHigh: doublePrecision(),
    refText: text(), // verbatim range: "<200", "> OR = 40", "See Note"
    flag: labFlag(),
    method: text(),
    performingLab: text(),
    note: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("lab_results_panel_analyte_uq").on(t.panelId, t.analyte),
    index("lab_results_user_analyte_idx").on(t.userId, t.analyte),
    ownerPolicy(t),
  ],
);

export const fitnessTests = pgTable(
  "fitness_tests",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    performedOn: date().notNull(),
    testType: fitnessTestType().notNull(),
    provider: text(), // e.g. "DexaFit Nashua"
    documentId: uuid().references(() => documents.id),
    primaryValue: doublePrecision(), // headline: 47 ml/kg/min, 2144 kcal/day
    primaryUnit: text(),
    /** Shape is Zod-typed per testType in core/schemas/fitnessTests.ts. */
    results: jsonb().$type<Record<string, unknown>>(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("fitness_tests_user_type_date_uq").on(t.userId, t.testType, t.performedOn),
    ownerPolicy(t),
  ],
);

// ---------------------------------------------------------------------------
// 5.7 Goals & insights
// ---------------------------------------------------------------------------

export const goals = pgTable(
  "goals",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text().notNull(),
    domain: goalDomain().notNull(),
    description: text(),
    priority: integer().notNull().default(100), // lower = more important
    target: jsonb().$type<{
      metric?: string;
      targetValue?: number;
      unit?: string;
      direction?: "increase" | "decrease" | "maintain";
    }>(),
    targetDate: date(),
    status: goalStatus().notNull().default("active"),
    statusChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("goals_user_status_idx").on(t.userId, t.status),
    ownerPolicy(t),
  ],
);

export const insights = pgTable(
  "insights",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text().notNull(),
    body: text().notNull(),
    tags: text().array().notNull().default([]),
    status: insightStatus().notNull().default("active"),
    source: insightSource().notNull().default("agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("insights_user_status_idx").on(t.userId, t.status),
    ownerPolicy(t),
  ],
);

// ---------------------------------------------------------------------------
// 5.8 Subjective observations
// ---------------------------------------------------------------------------

export const observations = pgTable(
  "observations",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    observedAt: timestamp({ withTimezone: true }).notNull(),
    localDate: date().notNull(),
    kind: observationKind().notNull(),
    valueNum: integer(), // 1-5 where applicable
    bodyArea: text(),
    text: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("observations_user_date_idx").on(t.userId, t.localDate),
    ownerPolicy(t),
  ],
);

// ---------------------------------------------------------------------------
// Training plans (specs/04-training-plans/SPEC.md §3)
// ---------------------------------------------------------------------------

/** Checkpoints on the way to a goal, e.g. "30 mi/week base by Dec 2026". */
export const goalMilestones = pgTable(
  "goal_milestones",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: uuid()
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text(),
    target: jsonb().$type<{
      metric?: string;
      targetValue?: number;
      unit?: string;
      direction?: "increase" | "decrease" | "maintain";
    }>(),
    targetDate: date(),
    status: goalStatus().notNull().default("active"),
    statusChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("goal_milestones_user_status_idx").on(t.userId, t.status),
    index("goal_milestones_goal_idx").on(t.goalId),
    ownerPolicy(t),
  ],
);

/** One plan per calendar week; `focus` is the light phase concept (SPEC 04 decision #5). */
export const trainingWeeks = pgTable(
  "training_weeks",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStart: date().notNull(), // the Monday
    focus: text(), // e.g. "aerobic base + maintain strength"
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("training_weeks_user_week_uq").on(t.userId, t.weekStart),
    ownerPolicy(t),
  ],
);

export const plannedSessions = pgTable(
  "planned_sessions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekId: uuid()
      .notNull()
      .references(() => trainingWeeks.id, { onDelete: "cascade" }),
    plannedDate: date().notNull(),
    title: text().notNull(),
    status: plannedSessionStatus().notNull().default("planned"),
    statusChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One planned session per day — no two-a-days (SPEC 04 §3.2).
    uniqueIndex("planned_sessions_user_date_uq").on(t.userId, t.plannedDate),
    index("planned_sessions_week_idx").on(t.weekId),
    ownerPolicy(t),
  ],
);

/** Prescription counterpart of workout_blocks; targets, not results. */
export const plannedBlocks = pgTable(
  "planned_blocks",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plannedSessionId: uuid()
      .notNull()
      .references(() => plannedSessions.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    blockType: blockType().notNull(),
    // metcon prescription
    scheme: metconScheme(),
    roundsPlanned: integer(),
    timeCapS: integer(),
    intervalS: integer(),
    // cardio prescription (canonical units)
    targetDistanceM: doublePrecision(),
    targetDurationS: integer(),
    targetPaceSPerKm: doublePrecision(),
    structure: text(), // interval description, e.g. "5 × 3:00 @ RPE 6 / 2:00 jog"
    targetRpe: integer(),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("planned_blocks_session_idx").on(t.plannedSessionId),
    ownerPolicy(t),
  ],
);

/**
 * Prescription per movement: uniform sets × reps @ target load — there is
 * deliberately no planned_sets table (SPEC 04 decision #3). Numeric fields are
 * canonical; repsText/prescription are display/irregular-scheme escape hatches.
 */
export const plannedBlockMovements = pgTable(
  "planned_block_movements",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plannedBlockId: uuid()
      .notNull()
      .references(() => plannedBlocks.id, { onDelete: "cascade" }),
    movementId: uuid()
      .notNull()
      .references(() => movements.id),
    seq: integer().notNull(),
    sets: integer(),
    reps: integer(),
    repsText: text(), // "8-10", "21-15-9", "AMRAP"
    targetLoadKg: doublePrecision(),
    targetRpe: integer(),
    restS: integer(),
    prescription: text(), // display text, e.g. "4×8 @ 135 lb"
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("planned_block_movements_block_idx").on(t.plannedBlockId),
    ownerPolicy(t),
  ],
);

/**
 * Append-only adjustment history, written in the same transaction as the plan
 * mutation it describes (SPEC 04 decision #7) — the reinforcement loop's
 * training data ("skipped 3 Fridays running").
 */
export const planChanges = pgTable(
  "plan_changes",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekId: uuid()
      .notNull()
      .references(() => trainingWeeks.id, { onDelete: "cascade" }),
    plannedSessionId: uuid().references(() => plannedSessions.id, { onDelete: "set null" }),
    category: planChangeCategory().notNull(),
    summary: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("plan_changes_week_idx").on(t.weekId),
    ownerPolicy(t),
  ],
);

// ---------------------------------------------------------------------------
// Athlete model (specs/04-training-plans/SPEC.md §3.4) — the reinforcement substrate
// ---------------------------------------------------------------------------

/**
 * What's available to train with. Names should align with the movement
 * catalog's `equipment` vocabulary so feasibility is a join away.
 */
export const equipmentItems = pgTable(
  "equipment_items",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    category: equipmentCategory().notNull().default("other"),
    details: jsonb().$type<Record<string, unknown>>(), // { min/max load, increments, count, ... }
    location: text(), // "garage", "gym"
    active: boolean().notNull().default(true), // deactivate, don't delete — preserves history
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("equipment_items_user_name_uq").on(t.userId, t.name),
    ownerPolicy(t),
  ],
);

/**
 * The agent's current belief about a capability — one row per natural key,
 * upserted; the progression history lives in the actuals, not here (SPEC 04
 * decision #12). `basis` cites the evidence ("5×5 @ 84 kg on 2026-07-01, RPE 7").
 */
export const capabilityEstimates = pgTable(
  "capability_estimates",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    movementId: uuid().references(() => movements.id), // null for movement-less capacities
    metric: text().notNull(), // 'working_load' | 'e1rm' | 'weekly_run_volume' | 'long_run_distance' | 'zone2_pace' | ...
    repMax: integer(), // value is an N-rep working estimate (strength metrics)
    value: doublePrecision().notNull(),
    unit: text().notNull(), // canonical: kg | m | s | s_per_km | m_per_week
    confidence: estimateConfidence().notNull().default("medium"),
    basis: text().notNull(),
    effectiveDate: date().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Natural key with nullable columns (movement-less metrics, repMax-less
    // estimates) — NULLS NOT DISTINCT so there's exactly one belief per key.
    unique("capability_estimates_nk_uq")
      .on(t.userId, t.movementId, t.metric, t.repMax)
      .nullsNotDistinct(),
    index("capability_estimates_user_metric_idx").on(t.userId, t.metric),
    ownerPolicy(t),
  ],
);

/**
 * Standing rules the planner must respect ("no outdoor runs below −12°C",
 * "long run Saturday mornings"). Binding, unlike insights (fuzzy observations).
 */
export const planningConstraints = pgTable(
  "planning_constraints",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: constraintKind().notNull(),
    rule: text().notNull(),
    params: jsonb().$type<Record<string, unknown>>(),
    active: boolean().notNull().default(true),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("planning_constraints_user_active_idx").on(t.userId, t.active),
    ownerPolicy(t),
  ],
);

// ---------------------------------------------------------------------------
// Personal food catalog & recipes (specs/05-nutrition-accuracy/SPEC.md §4)
// ---------------------------------------------------------------------------

export const foodSource = pgEnum("food_source", ["label", "fdc", "off", "estimate"]);

/** One household portion of a food, e.g. { label: "1 scoop", grams: 31 }. */
export interface FoodPortion {
  label: string;
  grams: number;
}

/**
 * Per-user verified food catalog — demand-driven, not a mirror of any global
 * DB (SPEC 05 decision #3). Macros are stored per 100 g (canonical mass
 * basis); `portions` maps household measures to grams so the server, never
 * the LLM, does portion→gram→macro math (SPEC 05 decision #1).
 */
export const foods = pgTable(
  "foods",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    canonicalName: text().notNull(),
    brand: text(),
    /** Every name this food gets logged under; matched case-insensitively. */
    aliases: text().array().notNull().default([]),
    barcode: text(), // GTIN/UPC, digits as scanned/typed
    caloriesPer100g: doublePrecision().notNull(),
    proteinPer100g: doublePrecision().notNull(),
    carbsPer100g: doublePrecision().notNull(),
    fatPer100g: doublePrecision().notNull(),
    /** Per 100 g, same keys as meal_items.micros: fiber_g, sugar_g, sat_fat_g, sodium_mg, ... */
    micros: jsonb().$type<Record<string, number>>(),
    portions: jsonb().$type<FoodPortion[]>().notNull().default([]),
    source: foodSource().notNull(),
    sourceRef: text(), // fdcId / Open Food Facts code
    verified: boolean().notNull().default(false),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("foods_user_name_uq").on(t.userId, sql`lower(${t.canonicalName})`),
    uniqueIndex("foods_user_barcode_uq")
      .on(t.userId, t.barcode)
      .where(sql`${t.barcode} is not null`),
    ownerPolicy(t),
  ],
);

/**
 * Reusable composite meals ("my protein smoothie") — items reference catalog
 * foods by grams; per-serving totals are derived on read, never stored.
 */
export const recipes = pgTable(
  "recipes",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    aliases: text().array().notNull().default([]),
    servings: doublePrecision().notNull().default(1),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("recipes_user_name_uq").on(t.userId, sql`lower(${t.name})`),
    ownerPolicy(t),
  ],
);

export const recipeItems = pgTable(
  "recipe_items",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipeId: uuid()
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    // Default NO ACTION: a food referenced by a recipe can't be deleted.
    foodId: uuid()
      .notNull()
      .references(() => foods.id),
    grams: doublePrecision().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("recipe_items_recipe_idx").on(t.recipeId), ownerPolicy(t)],
);
