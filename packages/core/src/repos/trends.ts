/**
 * Range / time-series reads for the PWA dashboard (specs/02-pwa-client/SPEC.md §4).
 *
 * Storage is daily-grain; week/month buckets are computed on read with a
 * per-metric aggregation — intake/mileage/burn are additive (sum within the
 * bucket), Body Battery and resting HR are averages. Series are dense: one
 * point per bucket in range, `value: null` where nothing was logged (a day
 * with no meals is "not logged", not "ate zero"), with `daysWithData` so
 * clients can render daily averages of additive metrics (value / days).
 *
 * Buckets are labeled by start date: the day itself, the ISO Monday, or the
 * 1st of the month. Edge buckets of a range aggregate only in-range days.
 * Values are canonical units (kcal, bpm, meters) — display conversion is the
 * adapter's job, never core's.
 */
import { and, eq, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db, UserCtx } from "../db/client.js";
import {
  blockMovements,
  bodyMeasurements,
  dailyMetrics,
  meals,
  strengthSets,
  workoutBlocks,
  workoutSessions,
} from "../db/schema.js";
import type { TrendBucket, TrendMetric, TrendQuery } from "../schemas/trends.js";

export interface TrendPoint {
  /** Bucket start date, YYYY-MM-DD. */
  bucket: string;
  /** Aggregated value in canonical units; null when no data in the bucket. */
  value: number | null;
  /** Distinct local dates contributing data to this bucket. */
  daysWithData: number;
}

export interface TrendSeries {
  key: string;
  /** How daily values combine into week/month buckets. */
  agg: "sum" | "avg";
  /** Canonical unit: kcal, bpm, m, score. */
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

const MAX_RANGE_DAYS = 3660; // ~10 years — bounds response size, not a product limit

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseUtc(d: string): Date {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, dd!));
}

function addDays(d: string, n: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, dd! + n)).toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `d`. */
function isoWeekStart(d: string): string {
  return addDays(d, -((parseUtc(d).getUTCDay() + 6) % 7));
}

function monthStart(d: string): string {
  return `${d.slice(0, 7)}-01`;
}

function nextMonth(d: string): string {
  const [y, m] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
}

/** Every bucket start covering [from, to], inclusive and dense. */
function bucketStarts(from: string, to: string, bucket: TrendBucket): string[] {
  const starts: string[] = [];
  let cur = bucket === "day" ? from : bucket === "week" ? isoWeekStart(from) : monthStart(from);
  while (cur <= to) {
    starts.push(cur);
    cur = bucket === "day" ? addDays(cur, 1) : bucket === "week" ? addDays(cur, 7) : nextMonth(cur);
  }
  return starts;
}

/** SQL expression for the bucket-start label of a local_date column, as text. */
function bucketExpr(col: SQL | { getSQL(): SQL }, bucket: TrendBucket): SQL<string> {
  if (bucket === "day") return sql<string>`${col}::text`;
  return sql<string>`(date_trunc(${bucket}, ${col}::timestamp))::date::text`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Assemble a dense series from grouped rows keyed by bucket start. */
function toSeries(
  key: string,
  agg: "sum" | "avg",
  unit: string,
  starts: string[],
  rows: Map<string, { value: number | null; days: number }>,
): TrendSeries {
  const points = starts.map((bucket) => {
    const row = rows.get(bucket);
    const hasData = (row?.days ?? 0) > 0 && row?.value != null;
    return {
      bucket,
      value: hasData ? r1(row!.value!) : null,
      daysWithData: hasData ? row!.days : 0,
    };
  });
  return { key, agg, unit, points };
}

/**
 * One time-series read per SPEC §4's metric table. Validation is repeated
 * here (not just in the Zod query schema) so direct repo callers get the
 * same guarantees as the REST adapter.
 */
export async function getTrend(db: Db, ctx: UserCtx, query: TrendQuery): Promise<TrendResult> {
  const { metric, from, to, bucket } = query;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    throw new Error(`Invalid date range: ${from}..${to} (expected YYYY-MM-DD)`);
  }
  if (from > to) throw new Error(`Invalid range: from ${from} is after to ${to}`);
  const rangeDays = (parseUtc(to).getTime() - parseUtc(from).getTime()) / 86_400_000 + 1;
  if (rangeDays > MAX_RANGE_DAYS) {
    throw new Error(`Range too large: ${rangeDays} days (max ${MAX_RANGE_DAYS})`);
  }

  const starts = bucketStarts(from, to, bucket);
  let series: TrendSeries[];
  switch (metric) {
    case "calories_in":
      series = await caloriesIn(db, ctx, from, to, bucket, starts);
      break;
    case "distance_run":
      series = await distanceRun(db, ctx, from, to, bucket, starts);
      break;
    case "body_battery":
      series = await fromDailyMetrics(db, ctx, from, to, bucket, starts, [
        { key: "high", agg: "avg", unit: "score", col: dailyMetrics.bodyBattery },
        { key: "low", agg: "avg", unit: "score", col: dailyMetrics.bodyBatteryLow },
      ]);
      break;
    case "resting_hr":
      series = await fromDailyMetrics(db, ctx, from, to, bucket, starts, [
        { key: "resting_hr", agg: "avg", unit: "bpm", col: dailyMetrics.restingHr },
      ]);
      break;
    case "calories_out":
      series = await fromDailyMetrics(db, ctx, from, to, bucket, starts, [
        { key: "active", agg: "sum", unit: "kcal", col: dailyMetrics.activeKcal },
        { key: "bmr", agg: "sum", unit: "kcal", col: dailyMetrics.bmrKcal },
      ]);
      break;
    case "sleep":
      series = await fromDailyMetrics(db, ctx, from, to, bucket, starts, [
        // Canonical seconds; the adapter renders as hours (SPEC §3).
        { key: "sleep", agg: "avg", unit: "s", col: dailyMetrics.sleepDurationS },
      ]);
      break;
    case "hrv":
      series = await fromDailyMetrics(db, ctx, from, to, bucket, starts, [
        { key: "hrv", agg: "avg", unit: "ms", col: dailyMetrics.hrvMs },
      ]);
      break;
    case "steps":
      series = await fromDailyMetrics(db, ctx, from, to, bucket, starts, [
        { key: "steps", agg: "sum", unit: "steps", col: dailyMetrics.steps },
      ]);
      break;
    case "stress":
      series = await fromDailyMetrics(db, ctx, from, to, bucket, starts, [
        { key: "stress", agg: "avg", unit: "score", col: dailyMetrics.stressScore },
      ]);
      break;
    case "body_weight":
      series = await fromBodyMeasurements(db, ctx, from, to, bucket, starts, [
        // Canonical kg; the adapter converts to the user's unit (SPEC §3).
        { key: "weight", unit: "kg", col: bodyMeasurements.weightKg },
      ]);
      break;
    case "body_fat":
      series = await fromBodyMeasurements(db, ctx, from, to, bucket, starts, [
        { key: "body_fat", unit: "%", col: bodyMeasurements.bodyFatPct },
      ]);
      break;
    case "strength_volume":
      series = await strengthVolume(db, ctx, from, to, bucket, starts);
      break;
    case "workout_frequency":
      series = await workoutFrequency(db, ctx, from, to, bucket, starts);
      break;
  }
  return { metric, bucket, from, to, series };
}

async function caloriesIn(
  db: Db,
  ctx: UserCtx,
  from: string,
  to: string,
  bucket: TrendBucket,
  starts: string[],
): Promise<TrendSeries[]> {
  const b = bucketExpr(meals.localDate, bucket);
  const rows = await db
    .select({
      bucket: b.as("bucket"),
      value: sql<number | null>`sum(${meals.calories})::double precision`,
      days: sql<number>`count(distinct ${meals.localDate})::int`,
    })
    .from(meals)
    .where(and(eq(meals.userId, ctx.userId), gte(meals.localDate, from), lte(meals.localDate, to)))
    .groupBy(sql`1`);
  const byBucket = new Map(rows.map((r) => [r.bucket, { value: r.value, days: r.days }]));
  return [toSeries("calories", "sum", "kcal", starts, byBucket)];
}

async function distanceRun(
  db: Db,
  ctx: UserCtx,
  from: string,
  to: string,
  bucket: TrendBucket,
  starts: string[],
): Promise<TrendSeries[]> {
  const b = bucketExpr(workoutSessions.localDate, bucket);
  const rows = await db
    .select({
      bucket: b.as("bucket"),
      value: sql<number | null>`sum(${workoutBlocks.distanceM})::double precision`,
      days: sql<number>`count(distinct ${workoutSessions.localDate})::int`,
    })
    .from(workoutBlocks)
    .innerJoin(workoutSessions, eq(workoutBlocks.sessionId, workoutSessions.id))
    .where(
      and(
        eq(workoutBlocks.userId, ctx.userId),
        eq(workoutBlocks.blockType, "run"),
        isNotNull(workoutBlocks.distanceM),
        gte(workoutSessions.localDate, from),
        lte(workoutSessions.localDate, to),
      ),
    )
    .groupBy(sql`1`);
  const byBucket = new Map(rows.map((r) => [r.bucket, { value: r.value, days: r.days }]));
  return [toSeries("distance", "sum", "m", starts, byBucket)];
}

interface DailyMetricSeriesSpec {
  key: string;
  agg: "sum" | "avg";
  unit: string;
  col: AnyPgColumn; // an integer column of daily_metrics
}

/**
 * daily_metrics-backed series share one grouped query; each column carries
 * its own days count (count(col) skips nulls) so e.g. a day with a Body
 * Battery high but no low doesn't inflate the low series.
 */
async function fromDailyMetrics(
  db: Db,
  ctx: UserCtx,
  from: string,
  to: string,
  bucket: TrendBucket,
  starts: string[],
  specs: DailyMetricSeriesSpec[],
): Promise<TrendSeries[]> {
  const b = bucketExpr(dailyMetrics.localDate, bucket);
  const selection: Record<string, SQL | SQL.Aliased> = { bucket: b.as("bucket") };
  for (const s of specs) {
    selection[`${s.key}__value`] =
      s.agg === "sum"
        ? sql`sum(${s.col})::double precision`
        : sql`avg(${s.col})::double precision`;
    selection[`${s.key}__days`] = sql`count(${s.col})::int`;
  }
  const rows = (await db
    .select(selection)
    .from(dailyMetrics)
    .where(
      and(
        eq(dailyMetrics.userId, ctx.userId),
        gte(dailyMetrics.localDate, from),
        lte(dailyMetrics.localDate, to),
      ),
    )
    .groupBy(sql`1`)) as unknown as Array<Record<string, unknown>>;

  return specs.map((s) => {
    const byBucket = new Map(
      rows.map((r) => [
        r.bucket as string,
        { value: r[`${s.key}__value`] as number | null, days: r[`${s.key}__days`] as number },
      ]),
    );
    return toSeries(s.key, s.agg, s.unit, starts, byBucket);
  });
}

interface BodyMeasurementSeriesSpec {
  key: string;
  unit: string;
  col: AnyPgColumn; // a numeric column of body_measurements
}

/**
 * body_measurements-backed series (weight, body-fat %). Unlike daily_metrics,
 * this table has no local_date column and can hold several readings per day
 * (e.g. a scale sync plus a DEXA), so we derive the local date from
 * measured_at in the user's timezone and average all readings in the bucket.
 * daysWithData counts distinct local dates *with this column present*, so a
 * weight-only reading doesn't inflate the body-fat series' day-weighting.
 */
async function fromBodyMeasurements(
  db: Db,
  ctx: UserCtx,
  from: string,
  to: string,
  bucket: TrendBucket,
  starts: string[],
  specs: BodyMeasurementSeriesSpec[],
): Promise<TrendSeries[]> {
  const localDate = sql<string>`((${bodyMeasurements.measuredAt} at time zone ${ctx.timezone})::date)`;
  const b = bucketExpr(localDate, bucket);
  const selection: Record<string, SQL | SQL.Aliased> = { bucket: b.as("bucket") };
  for (const s of specs) {
    selection[`${s.key}__value`] = sql`avg(${s.col})::double precision`;
    selection[`${s.key}__days`] = sql`count(distinct case when ${s.col} is not null then ${localDate} end)::int`;
  }
  const rows = (await db
    .select(selection)
    .from(bodyMeasurements)
    .where(and(eq(bodyMeasurements.userId, ctx.userId), gte(localDate, from), lte(localDate, to)))
    .groupBy(sql`1`)) as unknown as Array<Record<string, unknown>>;

  return specs.map((s) => {
    const byBucket = new Map(
      rows.map((r) => [
        r.bucket as string,
        { value: r[`${s.key}__value`] as number | null, days: r[`${s.key}__days`] as number },
      ]),
    );
    return toSeries(s.key, "avg", s.unit, starts, byBucket);
  });
}

/**
 * Working-set tonnage (canonical kg): sum of reps × load across strength sets,
 * excluding warm-ups. Joins sets → block_movements → blocks → sessions to reach
 * the session's local_date. Bucketed by session date, summed within the bucket.
 */
async function strengthVolume(
  db: Db,
  ctx: UserCtx,
  from: string,
  to: string,
  bucket: TrendBucket,
  starts: string[],
): Promise<TrendSeries[]> {
  const b = bucketExpr(workoutSessions.localDate, bucket);
  const rows = await db
    .select({
      bucket: b.as("bucket"),
      value: sql<number | null>`sum(${strengthSets.reps} * ${strengthSets.loadKg})::double precision`,
      days: sql<number>`count(distinct ${workoutSessions.localDate})::int`,
    })
    .from(strengthSets)
    .innerJoin(blockMovements, eq(strengthSets.blockMovementId, blockMovements.id))
    .innerJoin(workoutBlocks, eq(blockMovements.blockId, workoutBlocks.id))
    .innerJoin(workoutSessions, eq(workoutBlocks.sessionId, workoutSessions.id))
    .where(
      and(
        eq(strengthSets.userId, ctx.userId),
        eq(strengthSets.isWarmup, false),
        isNotNull(strengthSets.reps),
        isNotNull(strengthSets.loadKg),
        gte(workoutSessions.localDate, from),
        lte(workoutSessions.localDate, to),
      ),
    )
    .groupBy(sql`1`);
  const byBucket = new Map(rows.map((r) => [r.bucket, { value: r.value, days: r.days }]));
  return [toSeries("volume", "sum", "kg", starts, byBucket)];
}

/**
 * Training frequency: distinct workout sessions per bucket. Summed (a day is
 * 0/1/2… sessions); daysWithData is the count of distinct training days so the
 * tooltip's per-day average reads as sessions per active day.
 */
async function workoutFrequency(
  db: Db,
  ctx: UserCtx,
  from: string,
  to: string,
  bucket: TrendBucket,
  starts: string[],
): Promise<TrendSeries[]> {
  const b = bucketExpr(workoutSessions.localDate, bucket);
  const rows = await db
    .select({
      bucket: b.as("bucket"),
      value: sql<number | null>`count(*)::double precision`,
      days: sql<number>`count(distinct ${workoutSessions.localDate})::int`,
    })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, ctx.userId),
        gte(workoutSessions.localDate, from),
        lte(workoutSessions.localDate, to),
      ),
    )
    .groupBy(sql`1`);
  const byBucket = new Map(rows.map((r) => [r.bucket, { value: r.value, days: r.days }]));
  return [toSeries("sessions", "sum", "sessions", starts, byBucket)];
}
