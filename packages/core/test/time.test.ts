import { describe, expect, it } from "vitest";
import { localDateOf, todayIn, zonedToUtc } from "../src/time.js";

const NY = "America/New_York";

describe("localDateOf", () => {
  it("maps a UTC instant to the local calendar date", () => {
    // 2026-07-01T03:00Z is June 30 at 11pm in New York (EDT, UTC-4)
    expect(localDateOf(new Date("2026-07-01T03:00:00Z"), NY)).toBe("2026-06-30");
    expect(localDateOf(new Date("2026-07-01T12:00:00Z"), NY)).toBe("2026-07-01");
  });
});

describe("zonedToUtc", () => {
  it("converts EDT wall-clock to UTC", () => {
    expect(zonedToUtc("2026-07-01", "07:00", NY).toISOString()).toBe("2026-07-01T11:00:00.000Z");
  });

  it("converts EST wall-clock to UTC", () => {
    expect(zonedToUtc("2026-01-15", "07:00", NY).toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });

  it("round-trips with localDateOf across DST", () => {
    for (const date of ["2026-03-08", "2026-11-01", "2026-06-15", "2026-12-25"]) {
      expect(localDateOf(zonedToUtc(date, "12:00", NY), NY)).toBe(date);
    }
  });
});

describe("todayIn", () => {
  it("uses the reference instant", () => {
    expect(todayIn(NY, new Date("2026-07-01T03:00:00Z"))).toBe("2026-06-30");
  });
});
