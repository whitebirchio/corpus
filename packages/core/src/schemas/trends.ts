/**
 * Trend query shapes for the PWA's REST adapter (specs/02-pwa-client/SPEC.md §4).
 * Defined in core so the adapter and tests validate identically, mirroring
 * schemas/inputs.ts for the MCP tools.
 */
import { z } from "zod";
import { localDate } from "./inputs.js";

export const TREND_METRICS = [
  "calories_in",
  "body_battery",
  "resting_hr",
  "distance_run",
  "calories_out",
] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

export const TREND_BUCKETS = ["day", "week", "month"] as const;
export type TrendBucket = (typeof TREND_BUCKETS)[number];

export const trendQuerySchema = z
  .object({
    metric: z.enum(TREND_METRICS),
    from: localDate.describe("Range start, inclusive"),
    to: localDate.describe("Range end, inclusive"),
    bucket: z.enum(TREND_BUCKETS).default("day"),
  })
  .refine((q) => q.from <= q.to, { message: "from must be <= to" });
export type TrendQuery = z.infer<typeof trendQuerySchema>;
