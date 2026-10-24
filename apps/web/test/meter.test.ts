import { describe, expect, it } from "vitest";
import { gramsOver, meterStatus, WARN_RATIO } from "../src/format.js";

describe("gramsOver", () => {
  it("says how far over the target", () => {
    expect(gramsOver(182, 160)).toBe("22g over");
  });

  it("is silent at or under the target", () => {
    expect(gramsOver(160, 160)).toBeNull();
    expect(gramsOver(150, 160)).toBeNull();
  });

  it("is silent when the overage rounds to zero", () => {
    expect(gramsOver(160.3, 160)).toBeNull();
  });

  it("is silent without a target", () => {
    expect(gramsOver(182, null)).toBeNull();
  });
});

describe("meterStatus", () => {
  it("is under with nothing eaten", () => {
    expect(meterStatus(0, 2000)).toBe("under");
  });

  it("is under just below the warning ratio", () => {
    expect(meterStatus(1798, 2000)).toBe("under"); // 0.899
  });

  it("turns near exactly at the warning ratio", () => {
    expect(meterStatus(1800, 2000)).toBe("near"); // 0.9
  });

  it("stays near when landing exactly on target", () => {
    expect(meterStatus(2000, 2000)).toBe("near");
  });

  it("turns over just past the target", () => {
    expect(meterStatus(2000.2, 2000)).toBe("over"); // 1.0001
  });

  it("has no status without a target", () => {
    expect(meterStatus(1200, null)).toBeNull();
  });

  it("has no status for a zero target", () => {
    expect(meterStatus(1200, 0)).toBeNull();
  });

  it("warns at 90% of target", () => {
    expect(WARN_RATIO).toBe(0.9);
  });
});
