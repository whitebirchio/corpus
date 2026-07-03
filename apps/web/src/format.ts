/** Display formatting — all date math in the user's IANA timezone. */

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtCompact(n: number): string {
  return Math.abs(n) >= 10_000 ? `${(n / 1000).toFixed(1)}K` : fmtInt(n);
}

export function fmtGrams(n: number): string {
  return `${fmtInt(n)}g`;
}

/** "7:32 AM" for an ISO instant, in the user's timezone. */
export function fmtTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "Thu, Jul 3" for a YYYY-MM-DD local date (timezone-free by construction). */
export function fmtDate(localDate: string): string {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/** Short axis label for a bucket start: day/week → "Jun 5", month → "Jun ’26". */
export function fmtBucket(localDate: string, bucket: "day" | "week" | "month"): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  if (bucket === "month") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function addDays(localDate: string, n: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

export const MEAL_TYPE_LABEL: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};
