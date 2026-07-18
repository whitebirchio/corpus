/**
 * The REST surface (specs/02-pwa-client/IMPLEMENTATION.md §3.1): thin
 * validate → withUserDb → core repo → serialize shells. GET-only until the
 * barcode-logging writes (specs/05 §5) landed on the write-forward path the
 * routes were shaped for (SPEC §5.2).
 *
 * Every request re-loads the user row inside the same RLS transaction as the
 * repo call — timezone/unit changes apply immediately and the allowlist is
 * enforced per request, not just at sign-in.
 */
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import {
  formatDistance,
  formatDuration,
  formatMass,
  formatPace,
  getBodyMeasurementAsOf,
  getDailyMetrics,
  getDayNutrition,
  getDayWorkouts,
  getFoodByBarcode,
  getMealWithItems,
  getTrainingPlan,
  getTrend,
  getUser,
  getWorkoutDetail,
  kgToLb,
  localDate as localDateSchema,
  logMeal,
  logMealInput,
  macrosForGrams,
  metersToMiles,
  todayIn,
  trendQuerySchema,
  upsertFood,
  upsertFoodInput,
  type Db,
  type Food,
  type PlannedBlockDetail,
  type TrainingPlanResult,
  type TrendResult,
  type User,
  type UserCtx,
  type WorkoutBlockDetail,
  type WorkoutDetail,
} from "@corpus/core";
import { isSecureRequest, allowedEmails } from "./auth.js";
import { withUserDb } from "./db.js";
import { lookupBarcodeExternal } from "./nutrition.js";
import { newSession, sessionCookie, signSession, verifySession, SESSION_COOKIE } from "./session.js";

/** Thrown by handlers; mapped to a JSON error response in index.ts. */
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

type ApiEnv = { Bindings: Env; Variables: { uid: string } };

export const apiRoutes = new Hono<ApiEnv>();

apiRoutes.use("*", async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? await verifySession(token, c.env.SESSION_SECRET) : null;
  if (!session) throw new ApiError(401, "Not signed in");
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    // CSRF: SameSite=Lax plus this custom header on anything mutating
    // (SPEC §2 #15). v1 is read-only; the rule is set for the write phase.
    if (c.req.header("x-corpus-csrf") !== "1") {
      throw new ApiError(403, "Missing X-Corpus-Csrf header");
    }
  }
  c.set("uid", session.uid);
  await next();
  // Rolling session (SPEC §2 #8): each authenticated response restarts the
  // 90-day window.
  const fresh = await signSession(newSession(session.uid), c.env.SESSION_SECRET);
  c.res.headers.append("Set-Cookie", sessionCookie(fresh, isSecureRequest(c.req.url)));
});

/** Open the RLS-scoped transaction and resolve the fresh user row within it. */
async function runAsUser<T>(
  c: Context<ApiEnv>,
  fn: (db: Db, ctx: UserCtx, user: User) => Promise<T>,
): Promise<T> {
  const uid = c.get("uid");
  return withUserDb(c.env, uid, async (db) => {
    const user = await getUser(db, uid);
    if (!user) throw new ApiError(401, "Unknown user");
    if (!allowedEmails(c.env).includes(user.email.toLowerCase())) {
      throw new ApiError(403, "This Corpus instance is private.");
    }
    return fn(db, { userId: user.id, timezone: user.timezone, unitPreference: user.unitPreference }, user);
  });
}

function parseDateParam(c: Context<ApiEnv>): string {
  const date = c.req.param("date");
  if (!localDateSchema.safeParse(date).success) {
    throw new ApiError(400, "Invalid date — expected YYYY-MM-DD");
  }
  return date!;
}

apiRoutes.get("/me", async (c) => {
  const body = await runAsUser(c, async (_db, ctx, user) => ({
    user: {
      email: user.email,
      displayName: user.displayName,
      timezone: user.timezone,
      unitPreference: user.unitPreference,
    },
    today: todayIn(ctx.timezone),
  }));
  return c.json(body);
});

apiRoutes.get("/days/:date/nutrition", async (c) => {
  const date = parseDateParam(c);
  const day = await runAsUser(c, (db, ctx) => getDayNutrition(db, ctx, date));
  // Meals ride along whole (id, source, granularity, ...) — the dashboard
  // shows totals but the records stay addressable (SPEC §5.1).
  return c.json({ date, meals: day.meals, totals: day.totals, targets: day.targets ?? null });
});

apiRoutes.get("/days/:date/workouts", async (c) => {
  const date = parseDateParam(c);
  const workouts = await runAsUser(c, (db, ctx) => getDayWorkouts(db, ctx, date));
  // Flatten the enriched session into a glanceable card shape; the session id
  // stays addressable for a future detail view (SPEC §5.3).
  return c.json({
    date,
    workouts: workouts.map((w) => ({
      id: w.session.id,
      startedAt: w.session.startedAt,
      title: w.session.title,
      durationS: w.session.durationS,
      sessionRpe: w.session.sessionRpe,
      avgHr: w.session.avgHr,
      maxHr: w.session.maxHr,
      calories: w.session.calories,
      notes: w.session.notes,
      source: w.session.source,
      blockTypes: w.blockTypes,
      movements: w.movementNames,
      muscleGroups: w.muscleGroups,
    })),
  });
});

apiRoutes.get("/workouts/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Invalid workout id");
  const detail = await runAsUser(c, async (db, ctx, user) => {
    const d = await getWorkoutDetail(db, ctx, id!);
    return d ? serializeWorkoutDetail(d, user.unitPreference) : null;
  });
  if (!detail) throw new ApiError(404, "Workout not found");
  return c.json(detail);
});

apiRoutes.get("/days/:date/metrics", async (c) => {
  const date = parseDateParam(c);
  const metrics = await runAsUser(c, (db, ctx) => getDailyMetrics(db, ctx, date));
  return c.json({ date, metrics: metrics ?? null });
});

apiRoutes.get("/days/:date/body", async (c) => {
  const date = parseDateParam(c);
  const body = await runAsUser(c, async (db, ctx, user) => {
    const m = await getBodyMeasurementAsOf(db, ctx, date);
    if (!m) return null;
    // Canonical kg → the user's unit at the edge (SPEC §3).
    const imperial = user.unitPreference === "imperial";
    return {
      measuredOn: m.measuredOn,
      weight: r2(imperial ? kgToLb(m.weightKg) : m.weightKg),
      weightUnit: imperial ? "lb" : "kg",
      bodyFatPct: m.bodyFatPct,
    };
  });
  return c.json({ date, body });
});

apiRoutes.get("/meals/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Invalid meal id");
  const detail = await runAsUser(c, (db, ctx) => getMealWithItems(db, ctx, id!));
  if (!detail) throw new ApiError(404, "Meal not found");
  return c.json(detail);
});

// --- barcode logging (specs/05-nutrition-accuracy/SPEC.md §5) ---------------
// The PWA's first write surface, on the write-forward path epic 3 opened.

const GTIN = /^\d{8,14}$/;

/**
 * Catalog food → wire shape with per-portion macros precomputed server-side,
 * so the client renders numbers without doing nutrition math (SPEC §3 spirit:
 * conversions at the adapter edge).
 */
function serializeFood(f: Food) {
  return {
    id: f.id,
    name: f.canonicalName,
    brand: f.brand,
    verified: f.verified,
    per100g: {
      calories: f.caloriesPer100g,
      proteinG: f.proteinPer100g,
      carbsG: f.carbsPer100g,
      fatG: f.fatPer100g,
    },
    portions: f.portions.map((p) => ({
      label: p.label,
      grams: p.grams,
      macros: macrosForGrams(f, p.grams),
    })),
  };
}

apiRoutes.get("/foods/barcode/:gtin", async (c) => {
  const gtin = c.req.param("gtin");
  if (!gtin || !GTIN.test(gtin)) throw new ApiError(400, "Invalid barcode — expected 8–14 digits");
  const catalog = await runAsUser(c, (db, ctx) => getFoodByBarcode(db, ctx, gtin));
  if (catalog) return c.json({ status: "catalog" as const, food: serializeFood(catalog) });
  // Not ours yet: OFF → FDC Branded, normalized in core. The client offers
  // save-and-log, which round-trips through POST /foods so the entry sticks.
  const candidate = await lookupBarcodeExternal(c.env, gtin);
  if (candidate) return c.json({ status: "external" as const, candidate });
  return c.json({ status: "not_found" as const });
});

apiRoutes.post("/foods", async (c) => {
  const parsed = upsertFoodInput.safeParse(await c.req.json());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(400, `Invalid food: ${issue?.path.join(".")} ${issue?.message}`);
  }
  const result = await runAsUser(c, (db, ctx) => upsertFood(db, ctx, parsed.data));
  return c.json({ status: result.status, food: serializeFood(result.food) });
});

apiRoutes.post("/meals", async (c) => {
  const parsed = logMealInput.safeParse(await c.req.json());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(400, `Invalid meal: ${issue?.path.join(".")} ${issue?.message}`);
  }
  // Same core path as the MCP log_meal tool: catalog items resolved
  // server-side, near-duplicate detection included.
  const result = await runAsUser(c, (db, ctx) => logMeal(db, ctx, parsed.data));
  return c.json(result);
});

apiRoutes.get("/plan/week", async (c) => {
  const start = c.req.query("start");
  if (start !== undefined && !localDateSchema.safeParse(start).success) {
    throw new ApiError(400, "Invalid start — expected YYYY-MM-DD");
  }
  // Any date is normalized to its week's Monday in core (SPEC 04 §4.2).
  const body = await runAsUser(c, async (db, ctx, user) =>
    serializeTrainingPlan(await getTrainingPlan(db, ctx, start), user.unitPreference),
  );
  return c.json(body);
});

apiRoutes.get("/trends/:metric", async (c) => {
  const parsed = trendQuerySchema.safeParse({
    metric: c.req.param("metric"),
    from: c.req.query("from"),
    to: c.req.query("to"),
    bucket: c.req.query("bucket"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(400, `Invalid trend query: ${issue?.path.join(".")} ${issue?.message}`);
  }
  const body = await runAsUser(c, async (db, ctx, user) =>
    displayUnits(await getTrend(db, ctx, parsed.data), user.unitPreference),
  );
  return c.json(body);
});

type Pref = "imperial" | "metric";

/**
 * Canonical → display for the workout detail view: physical quantities become
 * pre-formatted strings in the user's units (SPEC §3), so the SPA renders them
 * verbatim. Reps/RPE/HR pass through as numbers.
 */
function serializeWorkoutDetail(d: WorkoutDetail, pref: Pref) {
  return {
    id: d.session.id,
    title: d.session.title,
    startedAt: d.session.startedAt,
    durationS: d.session.durationS,
    sessionRpe: d.session.sessionRpe,
    avgHr: d.session.avgHr,
    maxHr: d.session.maxHr,
    calories: d.session.calories,
    notes: d.session.notes,
    blocks: d.blocks.map((b) => serializeBlock(b, pref)),
  };
}

function serializeBlock(b: WorkoutBlockDetail, pref: Pref) {
  return {
    seq: b.seq,
    blockType: b.blockType,
    scheme: b.scheme,
    rounds: b.roundsPlanned,
    timeCap: b.timeCapS != null ? formatDuration(b.timeCapS) : null,
    result: metconResult(b),
    rx: b.rx,
    distance: b.distanceM != null ? formatDistance(b.distanceM, pref) : null,
    duration: b.durationS != null ? formatDuration(b.durationS) : null,
    pace: b.avgPaceSPerKm != null ? formatPace(b.avgPaceSPerKm, pref) : null,
    avgHr: b.avgHr,
    maxHr: b.maxHr,
    rpe: b.rpe,
    notes: b.notes,
    movements: b.movements.map((m) => ({
      name: m.name,
      prescription: m.prescription,
      repsPerRound: m.repsPerRound,
      load: m.loadKg != null ? formatMass(m.loadKg, pref) : null,
      distancePerRound: m.distanceMPerRound != null ? formatDistance(m.distanceMPerRound, pref) : null,
      sets: m.sets.map((s) => ({
        setNumber: s.setNumber,
        reps: s.reps,
        load: s.loadKg != null ? formatMass(s.loadKg, pref) : null,
        rpe: s.rpe,
        isWarmup: s.isWarmup,
        isFailure: s.isFailure,
        notes: s.notes,
      })),
    })),
  };
}

/** Planned week → wire shape: prescriptions as display strings (SPEC 04 §6). */
function serializeTrainingPlan(plan: TrainingPlanResult, pref: Pref) {
  return {
    weekStart: plan.weekStart,
    week: plan.week ? { focus: plan.week.focus, notes: plan.week.notes } : null,
    sessions: plan.sessions.map((s) => ({
      id: s.id,
      plannedDate: s.plannedDate,
      title: s.title,
      status: s.status,
      notes: s.notes,
      blocks: s.blocks.map((b) => serializePlannedBlock(b, pref)),
      linkedWorkouts: s.linkedWorkouts.map((w) => ({
        id: w.sessionId,
        title: w.title,
        startedAt: w.startedAt,
        duration: w.durationS != null ? formatDuration(w.durationS) : null,
      })),
    })),
    changes: plan.changes.map((ch) => ({
      category: ch.category,
      summary: ch.summary,
      plannedSessionId: ch.plannedSessionId,
      createdAt: ch.createdAt,
    })),
  };
}

function serializePlannedBlock(b: PlannedBlockDetail, pref: Pref) {
  return {
    seq: b.seq,
    blockType: b.blockType,
    scheme: b.scheme,
    rounds: b.roundsPlanned,
    timeCap: b.timeCapS != null ? formatDuration(b.timeCapS) : null,
    targetDistance: b.targetDistanceM != null ? formatDistance(b.targetDistanceM, pref) : null,
    targetDuration: b.targetDurationS != null ? formatDuration(b.targetDurationS) : null,
    targetPace: b.targetPaceSPerKm != null ? formatPace(b.targetPaceSPerKm, pref) : null,
    structure: b.structure,
    targetRpe: b.targetRpe,
    notes: b.notes,
    movements: b.movements.map((m) => ({
      name: m.name,
      sets: m.sets,
      reps: m.reps,
      repsText: m.repsText,
      targetLoad: m.targetLoadKg != null ? formatMass(m.targetLoadKg, pref) : null,
      targetRpe: m.targetRpe,
      rest: m.restS != null ? formatDuration(m.restS) : null,
      prescription: m.prescription,
      notes: m.notes,
    })),
  };
}

/** Compose a metcon's outcome into one line: time, rounds+reps, or reps. */
function metconResult(b: WorkoutBlockDetail): string | null {
  if (b.resultTimeS != null) return formatDuration(b.resultTimeS);
  if (b.resultRounds != null) {
    return b.resultReps ? `${b.resultRounds} rounds + ${b.resultReps}` : `${b.resultRounds} rounds`;
  }
  if (b.resultReps != null) return `${b.resultReps} reps`;
  return null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Canonical → display conversion at the adapter edge, never in core
 * (SPEC §3). Distance (m), mass (kg) and sleep (s) get converted; kcal, bpm,
 * ms, %, score, steps and sessions pass through unchanged.
 */
function displayUnits(trend: TrendResult, pref: "imperial" | "metric"): TrendResult {
  return {
    ...trend,
    series: trend.series.map((s) => {
      const conv = converterFor(s.unit, pref);
      if (!conv) return s;
      return {
        ...s,
        unit: conv.unit,
        points: s.points.map((p) => ({
          ...p,
          value: p.value == null ? null : r2(conv.convert(p.value)),
        })),
      };
    }),
  };
}

/** The display unit + conversion for a canonical unit, or null to pass through. */
function converterFor(
  unit: string,
  pref: "imperial" | "metric",
): { unit: string; convert: (v: number) => number } | null {
  switch (unit) {
    case "m":
      return pref === "imperial"
        ? { unit: "mi", convert: metersToMiles }
        : { unit: "km", convert: (m) => m / 1000 };
    case "kg":
      return pref === "imperial" ? { unit: "lb", convert: kgToLb } : null;
    case "s":
      // Sleep duration reads as hours regardless of unit system.
      return { unit: "h", convert: (v) => v / 3600 };
    default:
      return null;
  }
}
