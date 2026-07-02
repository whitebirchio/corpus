import { describe, expect, it } from "vitest";
import { parseLabValue, parseRefRange, resolveAnalyte } from "../src/labs/analytes.js";

describe("resolveAnalyte", () => {
  it("matches printed names, aliases, and canonical keys", () => {
    expect(resolveAnalyte("LDL-CHOLESTEROL")?.canonical).toBe("ldl_cholesterol");
    expect(resolveAnalyte("ldl_cholesterol")?.canonical).toBe("ldl_cholesterol");
    expect(resolveAnalyte("ApoB")?.canonical).toBe("apolipoprotein_b");
    expect(resolveAnalyte("HS CRP")?.canonical).toBe("hs_crp");
    expect(resolveAnalyte("VITAMIN D,25-OH,TOTAL,IA")?.canonical).toBe("vitamin_d_25oh");
    expect(resolveAnalyte("Sex Hormone Binding Globulin")?.canonical).toBe("shbg");
  });

  it("returns undefined for unknown analytes", () => {
    expect(resolveAnalyte("some novel marker")).toBeUndefined();
  });

  it("carries category and unit", () => {
    const ldl = resolveAnalyte("ldl_cholesterol");
    expect(ldl?.category).toBe("lipids");
    expect(ldl?.unit).toBe("mg/dL");
  });
});

describe("parseLabValue", () => {
  it("parses plain numbers", () => {
    expect(parseLabValue("168")).toEqual({ valueText: "168", valueNum: 168, comparator: "eq" });
    expect(parseLabValue("1.014").valueNum).toBe(1.014);
  });

  it("parses censored values", () => {
    expect(parseLabValue("<10")).toEqual({ valueText: "<10", valueNum: 10, comparator: "lt" });
    expect(parseLabValue("> OR = 40")).toMatchObject({ valueNum: 40, comparator: "ge" });
    expect(parseLabValue("< OR = 4.0")).toMatchObject({ valueNum: 4.0, comparator: "le" });
    expect(parseLabValue("≥56")).toMatchObject({ valueNum: 56, comparator: "ge" });
  });

  it("treats qualitative strings as non-numeric", () => {
    expect(parseLabValue("NEGATIVE")).toEqual({
      valueText: "NEGATIVE",
      valueNum: null,
      comparator: "eq",
    });
    expect(parseLabValue("NONE SEEN").valueNum).toBeNull();
    expect(parseLabValue("YELLOW").valueNum).toBeNull();
  });
});

describe("parseRefRange", () => {
  it("parses intervals and one-sided bounds", () => {
    expect(parseRefRange("250-425")).toEqual({ refLow: 250, refHigh: 425 });
    expect(parseRefRange("<200")).toEqual({ refLow: null, refHigh: 200 });
    expect(parseRefRange("> OR = 40")).toEqual({ refLow: 40, refHigh: null });
    expect(parseRefRange("See Note")).toEqual({ refLow: null, refHigh: null });
  });
});
