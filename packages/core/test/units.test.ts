import { describe, expect, it } from "vitest";
import {
  formatDistance,
  formatDuration,
  formatMass,
  formatPace,
  kgToLb,
  toKg,
  toMeters,
  toSeconds,
  toSecondsPerKm,
} from "../src/units.js";

describe("mass", () => {
  it("converts lb to kg", () => {
    expect(toKg({ value: 185, unit: "lb" })).toBeCloseTo(83.91, 2);
    expect(toKg({ value: 100, unit: "kg" })).toBe(100);
  });

  it("round-trips", () => {
    expect(kgToLb(toKg({ value: 225, unit: "lb" }))).toBeCloseTo(225, 6);
  });

  it("formats for display", () => {
    expect(formatMass(83.91452, "imperial")).toBe("185 lb");
    expect(formatMass(83.91452, "metric")).toBe("83.9 kg");
  });
});

describe("distance", () => {
  it("converts miles to meters", () => {
    expect(toMeters({ value: 5, unit: "mi" })).toBeCloseTo(8046.72, 1);
    expect(toMeters({ value: 5, unit: "km" })).toBe(5000);
  });

  it("formats for display", () => {
    expect(formatDistance(8046.72, "imperial")).toBe("5 mi");
    expect(formatDistance(5000, "metric")).toBe("5 km");
    expect(formatDistance(400, "metric")).toBe("400 m");
  });
});

describe("duration & pace", () => {
  it("converts durations", () => {
    expect(toSeconds({ value: 45, unit: "min" })).toBe(2700);
    expect(toSeconds({ value: 1.5, unit: "h" })).toBe(5400);
  });

  it("formats durations", () => {
    expect(formatDuration(5400)).toBe("1h 30m");
    expect(formatDuration(2700)).toBe("45m");
    expect(formatDuration(95)).toBe("1m 35s");
  });

  it("converts pace and formats round-trip", () => {
    // 9:00/mi = 540 s/mi = 335.54 s/km
    const sPerKm = toSecondsPerKm({ value: 9, unit: "min/mi" });
    expect(sPerKm).toBeCloseTo(540 / 1.609344, 1);
    expect(formatPace(sPerKm, "imperial")).toBe("9:00/mi");
    expect(formatPace(toSecondsPerKm({ value: 5, unit: "min/km" }), "metric")).toBe("5:00/km");
  });
});
