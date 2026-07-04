/**
 * The one chart wrapper (Recharts behind a local seam so the library is
 * swappable). Mark specs per the dataviz method: bars ≤24px with 4px rounded
 * data-ends and square baselines, 2px lines with surface-ringed dots, hairline
 * solid grid, one axis, crosshair/per-mark tooltip where values lead and
 * labels follow. Null buckets stay gaps — never fake zeros.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendResult } from "../api.js";
import { fmtBucket, fmtCompact, fmtMetric } from "../format.js";

export type ChartForm = "bar" | "stacked" | "line";

export interface SeriesMeta {
  label: string;
  /** CSS custom property reference, e.g. "var(--series-1)" — theme-aware. */
  color: string;
}

interface TrendChartProps {
  result: TrendResult;
  form: ChartForm;
  /** Render/tooltip order; for "stacked", first entry is the bottom segment. */
  series: Array<{ key: string } & SeriesMeta>;
}

type Row = Record<string, string | number | null>;

function toRows(result: TrendResult): Row[] {
  const rows = result.series[0]!.points.map((p) => ({ bucket: p.bucket }) as Row);
  for (const s of result.series) {
    s.points.forEach((p, i) => {
      rows[i]![s.key] = p.value;
      rows[i]![`${s.key}__days`] = p.daysWithData;
    });
  }
  return rows;
}

export function TrendChart({ result, form, series }: TrendChartProps) {
  const rows = toRows(result);
  const bucket = result.bucket;
  const unitOf = Object.fromEntries(result.series.map((s) => [s.key, s.unit]));
  const aggOf = Object.fromEntries(result.series.map((s) => [s.key, s.agg]));
  const showDots = rows.length <= 60;

  const axisTick = { fontSize: 11, fill: "var(--ink-muted)" } as const;
  const grid = (
    <CartesianGrid vertical={false} stroke="var(--hairline)" strokeWidth={1} />
  );
  const xAxis = (
    <XAxis
      dataKey="bucket"
      tickFormatter={(b: string) => fmtBucket(b, bucket)}
      tick={axisTick}
      tickLine={false}
      axisLine={{ stroke: "var(--baseline)", strokeWidth: 1 }}
      minTickGap={28}
      interval="preserveStartEnd"
    />
  );
  const yAxis = (
    <YAxis
      width={38}
      tick={{ ...axisTick, fontVariantNumeric: "tabular-nums" } as never}
      tickFormatter={(v: number) => fmtCompact(v)}
      tickLine={false}
      axisLine={false}
    />
  );
  const tooltip = (cursor: object | boolean) => (
    <Tooltip
      cursor={cursor}
      isAnimationActive={false}
      content={({ active, payload, label }) =>
        active && payload && payload.length > 0 ? (
          <TrendTooltip
            label={String(label)}
            bucket={bucket}
            row={payload[0]!.payload as Row}
            series={series}
            unitOf={unitOf}
            aggOf={aggOf}
          />
        ) : null
      }
    />
  );

  return (
    <div>
      {series.length > 1 ? (
        <div className="chart-legend">
          {series.map((s) => (
            <span className="key" key={s.key}>
              <span
                className={form === "line" ? "stroke" : "swatch"}
                style={{ background: s.color }}
              />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}
      <ResponsiveContainer width="100%" height={240}>
        {form === "line" ? (
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip({ stroke: "var(--baseline)", strokeWidth: 1 })}
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                connectNulls={false}
                isAnimationActive={false}
                dot={
                  showDots
                    ? { r: 3, fill: s.color, stroke: "var(--surface)", strokeWidth: 2 }
                    : false
                }
                activeDot={{ r: 4.5, fill: s.color, stroke: "var(--surface)", strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip({ fill: "var(--hairline)", fillOpacity: 0.45 })}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId={form === "stacked" ? "stack" : undefined}
                fill={s.color}
                maxBarSize={24}
                // 4px rounded data-end on the outermost segment, square baseline;
                // the surface-colored stroke is the 2px gap between stacked segments.
                radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                stroke={form === "stacked" ? "var(--surface)" : undefined}
                strokeWidth={form === "stacked" ? 1 : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function TrendTooltip({
  label,
  bucket,
  row,
  series,
  unitOf,
  aggOf,
}: {
  label: string;
  bucket: TrendResult["bucket"];
  row: Row;
  series: Array<{ key: string } & SeriesMeta>;
  unitOf: Record<string, string>;
  aggOf: Record<string, string>;
}) {
  // Tooltip lists every series at this X, values leading, line keys for identity.
  const ordered = [...series].reverse(); // stacked: top segment first
  return (
    <div className="viz-tooltip">
      <div className="t-when">
        {bucket === "day" ? "" : bucket === "week" ? "Week of " : ""}
        {fmtBucket(label, bucket)}
      </div>
      {ordered.map((s) => {
        const v = row[s.key] as number | null;
        const days = (row[`${s.key}__days`] as number) ?? 0;
        return (
          <div className="t-row" key={s.key}>
            <span className="line-key" style={{ background: s.color }} />
            <strong>{v == null ? "—" : `${fmtMetric(v, unitOf[s.key]!)} ${unitOf[s.key]}`}</strong>
            <span className="t-label">{s.label}</span>
            {v != null && bucket !== "day" && aggOf[s.key] === "sum" && days > 0 ? (
              <span className="t-label">· ≈{fmtMetric(v / days, unitOf[s.key]!)}/day</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
