/**
 * Typed client for the worker's REST surface. Types here describe the *wire*
 * shapes (dates as ISO strings after JSON serialization), so the SPA never
 * imports server types. The CSRF header rides on every non-GET (SPEC §2 #15).
 */

export interface ApiUser {
  email: string;
  displayName: string;
  timezone: string;
  unitPreference: "imperial" | "metric";
}

export interface MeResponse {
  user: ApiUser;
  today: string;
}

export interface ApiMeal {
  id: string;
  eatenAt: string;
  localDate: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  description: string;
  granularity: "itemized" | "totals";
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  source: string;
  notes: string | null;
}

export interface MacroTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface ApiTargets extends MacroTotals {
  fiberG: number | null;
  effectiveDate: string;
}

export interface DayNutritionResponse {
  date: string;
  meals: ApiMeal[];
  totals: MacroTotals;
  targets: ApiTargets | null;
}

export interface ApiWorkout {
  id: string;
  startedAt: string;
  title: string | null;
  durationS: number | null;
  sessionRpe: number | null;
  avgHr: number | null;
  maxHr: number | null;
  calories: number | null;
  notes: string | null;
  source: string;
  blockTypes: string[];
  movements: string[];
  muscleGroups: string[];
}

export interface DayWorkoutsResponse {
  date: string;
  workouts: ApiWorkout[];
}

export interface ApiWorkoutSet {
  setNumber: number;
  reps: number | null;
  load: string | null;
  rpe: number | null;
  isWarmup: boolean;
  isFailure: boolean;
  notes: string | null;
}

export interface ApiWorkoutMovement {
  name: string;
  prescription: string | null;
  repsPerRound: number | null;
  load: string | null;
  distancePerRound: string | null;
  sets: ApiWorkoutSet[];
}

export interface ApiWorkoutBlock {
  seq: number;
  blockType: string;
  scheme: string | null;
  rounds: number | null;
  timeCap: string | null;
  result: string | null;
  rx: boolean | null;
  distance: string | null;
  duration: string | null;
  pace: string | null;
  avgHr: number | null;
  maxHr: number | null;
  rpe: number | null;
  notes: string | null;
  movements: ApiWorkoutMovement[];
}

export interface WorkoutDetailResponse {
  id: string;
  title: string | null;
  startedAt: string;
  durationS: number | null;
  sessionRpe: number | null;
  avgHr: number | null;
  maxHr: number | null;
  calories: number | null;
  notes: string | null;
  blocks: ApiWorkoutBlock[];
}

export interface ApiDailyMetrics {
  sleepScore: number | null;
  sleepDurationS: number | null;
  sleepDeepS: number | null;
  sleepLightS: number | null;
  sleepRemS: number | null;
  sleepAwakeS: number | null;
  restingHr: number | null;
  hrvMs: number | null;
  steps: number | null;
  bodyBattery: number | null;
  bodyBatteryLow: number | null;
  stressScore: number | null;
  respirationAvg: number | null;
  spo2Avg: number | null;
  activeKcal: number | null;
  bmrKcal: number | null;
  intensityMinutesModerate: number | null;
  intensityMinutesVigorous: number | null;
  trainingReadiness: number | null;
  vo2max: number | null;
  energySubjective: number | null;
}

export interface DayMetricsResponse {
  date: string;
  metrics: ApiDailyMetrics | null;
}

export interface ApiBodyMeasurement {
  /** Local date of the reading; may predate the requested day. */
  measuredOn: string;
  weight: number;
  weightUnit: "lb" | "kg";
  bodyFatPct: number | null;
}

export interface DayBodyResponse {
  date: string;
  body: ApiBodyMeasurement | null;
}

export interface ApiPlannedMovement {
  name: string;
  sets: number | null;
  reps: number | null;
  repsText: string | null;
  targetLoad: string | null;
  targetRpe: number | null;
  rest: string | null;
  prescription: string | null;
  notes: string | null;
}

export interface ApiPlannedBlock {
  seq: number;
  blockType: string;
  scheme: string | null;
  rounds: number | null;
  timeCap: string | null;
  targetDistance: string | null;
  targetDuration: string | null;
  targetPace: string | null;
  structure: string | null;
  targetRpe: number | null;
  notes: string | null;
  movements: ApiPlannedMovement[];
}

export type PlannedSessionStatus = "planned" | "completed" | "skipped" | "cancelled";

export interface ApiPlannedSession {
  id: string;
  plannedDate: string;
  title: string;
  status: PlannedSessionStatus;
  notes: string | null;
  blocks: ApiPlannedBlock[];
  linkedWorkouts: Array<{
    id: string;
    title: string | null;
    startedAt: string;
    duration: string | null;
  }>;
}

export interface ApiPlanChange {
  category: string;
  summary: string;
  plannedSessionId: string | null;
  createdAt: string;
}

export interface PlanWeekResponse {
  weekStart: string;
  week: { focus: string | null; notes: string | null } | null;
  sessions: ApiPlannedSession[];
  changes: ApiPlanChange[];
}

export type TrendMetric =
  | "calories_in"
  | "body_battery"
  | "resting_hr"
  | "distance_run"
  | "calories_out"
  | "body_weight"
  | "body_fat"
  | "sleep"
  | "hrv"
  | "steps"
  | "stress"
  | "strength_volume"
  | "workout_frequency";
export type TrendBucket = "day" | "week" | "month";

export interface TrendPoint {
  bucket: string;
  value: number | null;
  daysWithData: number;
}

export interface TrendSeries {
  key: string;
  agg: "sum" | "avg";
  unit: string;
  points: TrendPoint[];
}

export interface TrendResult {
  metric: TrendMetric;
  bucket: TrendBucket;
  from: string;
  to: string;
  series: TrendSeries[];
}

// --- barcode logging (specs/05 §5) ------------------------------------------

export interface ApiFoodPortion {
  label: string;
  grams: number;
  macros: MacroTotals & { micros?: Record<string, number> };
}

export interface ApiFood {
  id: string;
  name: string;
  brand: string | null;
  verified: boolean;
  per100g: MacroTotals;
  portions: ApiFoodPortion[];
}

/** External-DB candidate, core's normalized shape riding the wire unchanged. */
export interface ApiFoodCandidate {
  name: string;
  brand?: string;
  barcode?: string;
  source: "fdc" | "off";
  sourceRef: string;
  per100g: MacroTotals & { micros?: Record<string, number> };
  portions: Array<{ label: string; grams: number }>;
}

export type BarcodeLookupResponse =
  | { status: "catalog"; food: ApiFood }
  | { status: "external"; candidate: ApiFoodCandidate }
  | { status: "not_found" };

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface LogMealRequest {
  mealType: MealType;
  description: string;
  items: Array<{
    name: string;
    foodId?: string;
    portionLabel?: string;
    quantity?: number;
    grams?: number;
    unitNote?: string;
  }>;
  allowDuplicate?: boolean;
}

export type LogMealResponse =
  | { status: "logged"; meal: ApiMeal; itemCount: number }
  | {
      status: "possible_duplicate";
      candidates: Array<{ mealId: string; description: string; calories: number; eatenAt: string }>;
    };

export interface UpsertFoodRequest {
  canonicalName: string;
  brand?: string;
  barcode?: string;
  per100g: MacroTotals & { micros?: Record<string, number> };
  portions?: Array<{ label: string; grams: number }>;
  source: "label" | "fdc" | "off" | "estimate";
  sourceRef?: string;
  verified?: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  return request(path, { headers: { accept: "application/json" } });
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return request(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-corpus-csrf": "1",
    },
    body: JSON.stringify(body),
  });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => get<MeResponse>("/api/me"),
  dayNutrition: (date: string) =>
    get<DayNutritionResponse>(`/api/days/${encodeURIComponent(date)}/nutrition`),
  dayWorkouts: (date: string) =>
    get<DayWorkoutsResponse>(`/api/days/${encodeURIComponent(date)}/workouts`),
  workoutDetail: (id: string) => get<WorkoutDetailResponse>(`/api/workouts/${encodeURIComponent(id)}`),
  dayMetrics: (date: string) =>
    get<DayMetricsResponse>(`/api/days/${encodeURIComponent(date)}/metrics`),
  dayBody: (date: string) =>
    get<DayBodyResponse>(`/api/days/${encodeURIComponent(date)}/body`),
  planWeek: (start?: string) =>
    get<PlanWeekResponse>(`/api/plan/week${start ? `?start=${encodeURIComponent(start)}` : ""}`),
  trend: (metric: TrendMetric, from: string, to: string, bucket: TrendBucket) =>
    get<TrendResult>(
      `/api/trends/${metric}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${bucket}`,
    ),
  logout: () =>
    fetch("/auth/logout", { method: "POST", headers: { "x-corpus-csrf": "1" } }),
  barcodeLookup: (gtin: string) =>
    get<BarcodeLookupResponse>(`/api/foods/barcode/${encodeURIComponent(gtin)}`),
  upsertFood: (food: UpsertFoodRequest) =>
    post<{ status: "created" | "updated"; food: ApiFood }>("/api/foods", food),
  logMeal: (meal: LogMealRequest) => post<LogMealResponse>("/api/meals", meal),
};
