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
  restingHr: number | null;
  hrvMs: number | null;
  steps: number | null;
  bodyBattery: number | null;
  bodyBatteryLow: number | null;
  stressScore: number | null;
  activeKcal: number | null;
  bmrKcal: number | null;
  trainingReadiness: number | null;
}

export interface DayMetricsResponse {
  date: string;
  metrics: ApiDailyMetrics | null;
}

export type TrendMetric =
  | "calories_in"
  | "body_battery"
  | "resting_hr"
  | "distance_run"
  | "calories_out";
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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
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
  trend: (metric: TrendMetric, from: string, to: string, bucket: TrendBucket) =>
    get<TrendResult>(
      `/api/trends/${metric}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${bucket}`,
    ),
  logout: () =>
    fetch("/auth/logout", { method: "POST", headers: { "x-corpus-csrf": "1" } }),
};
