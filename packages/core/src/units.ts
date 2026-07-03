/**
 * Unit handling — specs/01-initial-platform/SPEC.md §5 conventions.
 *
 * Storage is canonical metric: kg (mass), meters (distance), seconds
 * (duration), kcal (energy). Tools accept unit-tagged values and THIS module
 * converts — the LLM never does unit math. Display conversion for echo-back
 * lives here too so confirmations show the user's preferred units.
 */

export type MassUnit = "kg" | "lb" | "g" | "oz";
export type DistanceUnit = "m" | "km" | "mi" | "ft" | "yd";
export type DurationUnit = "s" | "min" | "h";
export type PaceUnit = "min/km" | "min/mi";

export interface UnitValue<U extends string> {
  value: number;
  unit: U;
}

const KG_PER: Record<MassUnit, number> = {
  kg: 1,
  lb: 0.45359237,
  g: 0.001,
  oz: 0.028349523125,
};

const M_PER: Record<DistanceUnit, number> = {
  m: 1,
  km: 1000,
  mi: 1609.344,
  ft: 0.3048,
  yd: 0.9144,
};

const S_PER: Record<DurationUnit, number> = {
  s: 1,
  min: 60,
  h: 3600,
};

export function toKg(v: UnitValue<MassUnit>): number {
  return v.value * KG_PER[v.unit];
}

export function toMeters(v: UnitValue<DistanceUnit>): number {
  return v.value * M_PER[v.unit];
}

export function toSeconds(v: UnitValue<DurationUnit>): number {
  return v.value * S_PER[v.unit];
}

/** Pace stored as seconds per km. */
export function toSecondsPerKm(v: UnitValue<PaceUnit>): number {
  // v.value is minutes per (km|mi)
  const secondsPerUnit = v.value * 60;
  return v.unit === "min/km" ? secondsPerUnit : secondsPerUnit / (M_PER.mi / 1000);
}

export function kgToLb(kg: number): number {
  return kg / KG_PER.lb;
}

export function metersToMiles(m: number): number {
  return m / M_PER.mi;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Human-readable rendering in the user's preferred units, for echo-back. */
export function formatMass(kg: number, pref: "imperial" | "metric"): string {
  return pref === "imperial" ? `${round1(kgToLb(kg))} lb` : `${round1(kg)} kg`;
}

export function formatDistance(m: number, pref: "imperial" | "metric"): string {
  if (pref === "imperial") return `${round1(metersToMiles(m))} mi`;
  return m >= 1000 ? `${round1(m / 1000)} km` : `${Math.round(m)} m`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${min}m`;
  if (min > 0) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  return `${sec}s`;
}

export function formatPace(sPerKm: number, pref: "imperial" | "metric"): string {
  const sPerUnit = pref === "imperial" ? sPerKm * (M_PER.mi / 1000) : sPerKm;
  const min = Math.floor(sPerUnit / 60);
  const sec = Math.round(sPerUnit % 60);
  const unit = pref === "imperial" ? "mi" : "km";
  return `${min}:${String(sec).padStart(2, "0")}/${unit}`;
}
