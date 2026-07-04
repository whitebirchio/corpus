import { useState } from "react";
import {
  api,
  type MeResponse,
  type TrendBucket,
  type TrendMetric,
  type TrendResult,
  type TrendSeries,
} from "../api.js";
import { TrendChart, type ChartForm, type SeriesMeta } from "../components/TrendChart.js";
import { addDays, fmtBucket, fmtMetric } from "../format.js";
import { useData } from "../useData.js";

/**
 * Trend visualizations (SPEC §4 use case 2). Defaults per the epic's open
 * question, now decided: last 30 days, day buckets; presets 7D/30D/90D/1Y
 * with a manual bucket override. A table view accompanies every chart.
 */

const METRICS: Array<{
  id: TrendMetric;
  label: string;
  form: ChartForm;
  series: Array<{ key: string } & SeriesMeta>;
}> = [
  {
    id: "calories_in",
    label: "Calories in",
    form: "bar",
    series: [{ key: "calories", label: "Calories", color: "var(--series-1)" }],
  },
  {
    id: "calories_out",
    label: "Calories out",
    form: "stacked",
    // Bottom-up stack: resting burn is the base, active rides on top.
    series: [
      { key: "bmr", label: "Resting (BMR)", color: "var(--series-2)" },
      { key: "active", label: "Active", color: "var(--series-1)" },
    ],
  },
  {
    id: "body_battery",
    label: "Body Battery",
    form: "line",
    series: [
      { key: "high", label: "High", color: "var(--series-1)" },
      { key: "low", label: "Low", color: "var(--series-2)" },
    ],
  },
  {
    id: "resting_hr",
    label: "Resting HR",
    form: "line",
    series: [{ key: "resting_hr", label: "Resting HR", color: "var(--series-1)" }],
  },
  {
    id: "distance_run",
    label: "Distance run",
    form: "bar",
    series: [{ key: "distance", label: "Distance", color: "var(--series-1)" }],
  },
  {
    id: "body_weight",
    label: "Weight",
    form: "line",
    series: [{ key: "weight", label: "Weight", color: "var(--series-1)" }],
  },
  {
    id: "body_fat",
    label: "Body fat",
    form: "line",
    series: [{ key: "body_fat", label: "Body fat", color: "var(--series-1)" }],
  },
  {
    id: "sleep",
    label: "Sleep",
    form: "bar",
    series: [{ key: "sleep", label: "Sleep", color: "var(--series-1)" }],
  },
  {
    id: "hrv",
    label: "HRV",
    form: "line",
    series: [{ key: "hrv", label: "HRV", color: "var(--series-1)" }],
  },
  {
    id: "steps",
    label: "Steps",
    form: "bar",
    series: [{ key: "steps", label: "Steps", color: "var(--series-1)" }],
  },
  {
    id: "stress",
    label: "Stress",
    form: "line",
    series: [{ key: "stress", label: "Stress", color: "var(--series-1)" }],
  },
  {
    id: "strength_volume",
    label: "Lifting volume",
    form: "bar",
    series: [{ key: "volume", label: "Volume", color: "var(--series-1)" }],
  },
  {
    id: "workout_frequency",
    label: "Workouts",
    form: "bar",
    series: [{ key: "sessions", label: "Workouts", color: "var(--series-1)" }],
  },
];

const RANGES = [
  { id: "7d", label: "7D", days: 7, bucket: "day" as TrendBucket },
  { id: "30d", label: "30D", days: 30, bucket: "day" as TrendBucket },
  { id: "90d", label: "90D", days: 90, bucket: "week" as TrendBucket },
  { id: "1y", label: "1Y", days: 365, bucket: "week" as TrendBucket },
];

export function Trends({ me }: { me: MeResponse }) {
  const [metricId, setMetricId] = useState<TrendMetric>("calories_in");
  const [rangeId, setRangeId] = useState("30d");
  const [bucketOverride, setBucketOverride] = useState<TrendBucket | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");

  const metric = METRICS.find((m) => m.id === metricId)!;
  const range = RANGES.find((r) => r.id === rangeId)!;
  const bucket = bucketOverride ?? range.bucket;
  const from = addDays(me.today, -(range.days - 1));
  const to = me.today;

  const trend = useData(() => api.trend(metricId, from, to, bucket), [metricId, from, to, bucket]);

  return (
    <>
      <div className="chip-row">
        {METRICS.map((m) => (
          <button
            key={m.id}
            className={`chip${m.id === metricId ? " active" : ""}`}
            onClick={() => setMetricId(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="seg-row">
        <div className="seg">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={r.id === rangeId ? "active" : ""}
              onClick={() => {
                setRangeId(r.id);
                setBucketOverride(null); // range presets re-pick a sensible bucket
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="seg">
          {(["day", "week", "month"] as const).map((b) => (
            <button
              key={b}
              className={b === bucket ? "active" : ""}
              onClick={() => setBucketOverride(b)}
            >
              {b === "day" ? "D" : b === "week" ? "W" : "M"}
            </button>
          ))}
        </div>
      </div>

      {trend.error ? <div className="card error-note">{trend.error}</div> : null}

      {trend.data ? (
        <div className={`tile-grid${trend.stale ? " stale" : ""}`}>
          {trend.data.series.map((s) => (
            <SummaryTile
              key={s.key}
              series={s}
              label={metric.series.find((sm) => sm.key === s.key)?.label ?? s.key}
            />
          ))}
        </div>
      ) : null}

      <section className={`card${trend.stale ? " stale" : ""}`}>
        <div className="seg-row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{metric.label}</h2>
          <div className="seg">
            <button className={view === "chart" ? "active" : ""} onClick={() => setView("chart")}>
              Chart
            </button>
            <button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>
              Table
            </button>
          </div>
        </div>
        {trend.data ? (
          view === "chart" ? (
            <TrendChart result={trend.data} form={metric.form} series={metric.series} />
          ) : (
            <TrendTable result={trend.data} metric={metric} />
          )
        ) : (
          <div className="empty-note">Loading…</div>
        )}
      </section>
    </>
  );
}

/**
 * One stat per series: additive metrics show the range total (+ per-day),
 * averaged metrics a day-weighted average — mirroring each series' agg.
 */
function SummaryTile({ series, label }: { series: TrendSeries; label: string }) {
  const present = series.points.filter((p) => p.value != null);
  const days = present.reduce((a, p) => a + p.daysWithData, 0);
  if (present.length === 0 || days === 0) {
    return (
      <div className="stat-tile">
        <div className="label">{label}</div>
        <div className="value">
          —<small> no data</small>
        </div>
      </div>
    );
  }
  if (series.agg === "sum") {
    const total = present.reduce((a, p) => a + (p.value ?? 0), 0);
    return (
      <div className="stat-tile">
        <div className="label">{label} — total</div>
        <div className="value">
          {fmtMetric(total, series.unit)}
          <small>
            {" "}
            {series.unit} · ≈{fmtMetric(total / days, series.unit)}/day
          </small>
        </div>
      </div>
    );
  }
  const weighted =
    present.reduce((a, p) => a + (p.value ?? 0) * p.daysWithData, 0) / days;
  return (
    <div className="stat-tile">
      <div className="label">{label} — average</div>
      <div className="value">
        {fmtMetric(weighted, series.unit)}
        <small> {series.unit}</small>
      </div>
    </div>
  );
}

/** The chart's non-visual twin — every plotted value, most recent first. */
function TrendTable({
  result,
  metric,
}: {
  result: TrendResult;
  metric: { series: Array<{ key: string; label: string }> };
}) {
  const buckets = result.series[0]!.points.map((p) => p.bucket);
  const byKey = Object.fromEntries(result.series.map((s) => [s.key, s]));
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>{result.bucket === "day" ? "Date" : result.bucket === "week" ? "Week of" : "Month"}</th>
            {metric.series.map((s) => (
              <th key={s.key}>
                {s.label} ({byKey[s.key]!.unit})
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...buckets].reverse().map((b, ri) => {
            const i = buckets.length - 1 - ri;
            return (
              <tr key={b}>
                <td>{fmtBucket(b, result.bucket)}</td>
                {metric.series.map((s) => {
                  const v = byKey[s.key]!.points[i]!.value;
                  return (
                    <td key={s.key} className={v == null ? "na" : ""}>
                      {v == null ? "—" : fmtMetric(v, byKey[s.key]!.unit)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
