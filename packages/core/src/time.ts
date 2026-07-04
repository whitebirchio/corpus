/**
 * Timezone-aware date handling. Timestamps are stored UTC; daily records key
 * on a `local_date` derived from the user's IANA timezone (specs/01-initial-platform/SPEC.md §5).
 * Implemented with Intl (available in Workers) — no date library needed.
 */

/** The YYYY-MM-DD calendar date of `instant` in `timeZone`. */
export function localDateOf(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The HH:mm wall-clock time of `instant` in `timeZone` (24-hour). */
export function localTimeOf(instant: Date, timeZone: string): string {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant)) {
    parts[p.type] = p.value;
  }
  // en-GB with hour12:false can render midnight as "24"; normalize to "00".
  const hh = parts.hour === "24" ? "00" : parts.hour;
  return `${hh}:${parts.minute}`;
}

/** Milliseconds that `timeZone` is ahead of UTC at `at`. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

/**
 * Interpret a wall-clock date + time in `timeZone` as a UTC instant.
 * Handles DST transitions by re-checking the offset once.
 */
export function zonedToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh = 0, mm = 0] = timeStr.split(":").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${dateStr}`);
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm);
  let offset = tzOffsetMs(new Date(utcGuess), timeZone);
  const ts = utcGuess - offset;
  const offset2 = tzOffsetMs(new Date(ts), timeZone);
  if (offset2 !== offset) offset = offset2;
  return new Date(utcGuess - offset);
}

/** Today's date (YYYY-MM-DD) in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localDateOf(now, timeZone);
}

/** Nominal local times for meals when the user gives a date but no time. */
export const NOMINAL_MEAL_TIMES: Record<string, string> = {
  breakfast: "08:00",
  lunch: "12:30",
  dinner: "18:30",
  snack: "15:00",
};
