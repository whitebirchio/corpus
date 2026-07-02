import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db, UserCtx } from "../src/db/client.js";
import { bodyCompositionRegions, bodyMeasurements } from "../src/db/schema.js";
import {
  getLabHistory,
  recordFitnessTest,
  recordLabPanel,
} from "../src/repos/labs.js";
import type { RecordLabPanelInput } from "../src/schemas/labs.js";
import { createTestDb, createTestUser } from "./helpers.js";

let db: Db;
let ctx: UserCtx;

beforeEach(async () => {
  ({ db } = await createTestDb());
  ctx = await createTestUser(db);
});

const junePanel: RecordLabPanelInput = {
  collectedOn: "2026-06-19",
  source: "function_health",
  labName: "Quest",
  accessionNumber: "WC992483A",
  fasting: true,
  results: [
    { analyte: "LDL-CHOLESTEROL", value: "96", unit: "mg/dL", refText: "<100", flag: "normal" },
    { analyte: "APOLIPOPROTEIN B", value: "100", unit: "mg/dL", refText: "<90", flag: "high" },
    { analyte: "LIPOPROTEIN (a)", value: "<10", unit: "nmol/L", refText: "<75" },
    { analyte: "ANA SCREEN, IFA", value: "NEGATIVE", refText: "NEGATIVE" },
    { analyte: "urine_color", rawName: "COLOR", value: "YELLOW" },
  ],
};

describe("recordLabPanel", () => {
  it("records a panel, canonicalizing analytes and parsing values", async () => {
    const result = await recordLabPanel(db, ctx, junePanel);
    expect(result.action).toBe("created");
    expect(result.resultsWritten).toBe(5);

    const ldl = await getLabHistory(db, ctx, "ldl_cholesterol");
    expect(ldl).toHaveLength(1);
    expect(ldl[0]).toMatchObject({ valueNum: 96, comparator: "eq", refHigh: 100, source: "function_health" });

    // Censored value keeps text + parses the bound/comparator
    const lpa = await getLabHistory(db, ctx, "lipoprotein_a");
    expect(lpa[0]).toMatchObject({ valueText: "<10", valueNum: 10, comparator: "lt" });

    // Qualitative value stored verbatim, no number
    const ana = await getLabHistory(db, ctx, "ana_screen");
    expect(ana[0]).toMatchObject({ valueText: "NEGATIVE", valueNum: null });
  });

  it("is idempotent by accession number (re-import updates, no duplicate)", async () => {
    await recordLabPanel(db, ctx, junePanel);
    const second = await recordLabPanel(db, ctx, junePanel);
    expect(second.action).toBe("updated");

    // Still a single value in history, not duplicated
    expect(await getLabHistory(db, ctx, "ldl_cholesterol")).toHaveLength(1);
  });

  it("surfaces a changed value on re-import instead of hiding it", async () => {
    await recordLabPanel(db, ctx, junePanel);
    const corrected = await recordLabPanel(db, ctx, {
      ...junePanel,
      results: [{ analyte: "LDL-CHOLESTEROL", value: "98", unit: "mg/dL", refText: "<100" }],
    });
    expect(corrected.changed).toEqual([
      { analyte: "ldl_cholesterol", from: "96", to: "98" },
    ]);
    expect((await getLabHistory(db, ctx, "ldl_cholesterol"))[0]?.valueNum).toBe(98);
  });

  it("builds a multi-panel trend for one analyte", async () => {
    await recordLabPanel(db, ctx, {
      collectedOn: "2026-01-10",
      source: "pcp",
      results: [{ analyte: "ldl_cholesterol", value: "112", unit: "mg/dL" }],
    });
    await recordLabPanel(db, ctx, junePanel);
    const trend = await getLabHistory(db, ctx, "ldl_cholesterol");
    expect(trend.map((p) => p.valueNum)).toEqual([112, 96]); // oldest first
  });
});

describe("recordFitnessTest", () => {
  it("records a VO2max test with typed results", async () => {
    const r = await recordFitnessTest(db, ctx, {
      performedOn: "2026-04-14",
      testType: "vo2max",
      provider: "DexaFit Nashua",
      primaryValue: 47,
      primaryUnit: "ml/kg/min",
      results: { biological_age: 33, max_hr: 176, vt1_bpm: 111, vt2_bpm: 168, redline_ratio: 94 },
    });
    expect(r.action).toBe("created");
    expect(r.bodyMeasurementId).toBeNull();
    expect(r.test.primaryValue).toBe(47);
  });

  it("fans a DEXA out to body_measurements + regions (lb -> kg)", async () => {
    const r = await recordFitnessTest(db, ctx, {
      performedOn: "2026-04-14",
      testType: "dexa",
      provider: "DexaFit Nashua",
      results: { body_score: "C+" },
      bodyComposition: {
        weight: { value: 171.1, unit: "lb" },
        bodyFatPct: 26.5,
        leanMass: { value: 120.5, unit: "lb" },
        fatMass: { value: 45.3, unit: "lb" },
        visceralFat: { value: 2.84, unit: "lb" },
        androidGynoidRatio: 1.84,
        almi: 9.2,
        ffmi: 20.2,
        bmdTotalGcm2: 1.191,
        bmdTscore: -0.1,
        bodyScore: "C+",
        regions: [
          { region: "arm", side: "left", leanMass: { value: 7.9, unit: "lb" }, fatMass: { value: 2.3, unit: "lb" } },
          { region: "arm", side: "right", leanMass: { value: 7.6, unit: "lb" }, fatMass: { value: 2.1, unit: "lb" } },
          { region: "leg", side: "left", leanMass: { value: 20.4, unit: "lb" } },
          { region: "leg", side: "right", leanMass: { value: 21.2, unit: "lb" } },
        ],
      },
    });
    expect(r.bodyMeasurementId).not.toBeNull();
    expect(r.regionsWritten).toBe(4);

    const bm = await db
      .select()
      .from(bodyMeasurements)
      .where(eq(bodyMeasurements.id, r.bodyMeasurementId!));
    expect(bm[0]?.weightKg).toBeCloseTo(77.61, 1);
    expect(bm[0]?.bodyFatPct).toBe(26.5);
    expect(bm[0]?.fitnessTestId).toBe(r.test.id);
    expect(bm[0]?.source).toBe("document_extraction");

    const regions = await db
      .select()
      .from(bodyCompositionRegions)
      .where(eq(bodyCompositionRegions.measurementId, r.bodyMeasurementId!));
    expect(regions).toHaveLength(4);
    const leftArm = regions.find((x) => x.region === "arm" && x.side === "left");
    expect(leftArm?.leanMassKg).toBeCloseTo(3.58, 1);
  });

  it("re-imports a DEXA idempotently (no duplicate regions)", async () => {
    const payload = {
      performedOn: "2026-04-14",
      testType: "dexa" as const,
      bodyComposition: {
        weight: { value: 171.1, unit: "lb" as const },
        regions: [{ region: "trunk" as const, side: "both" as const, leanMass: { value: 56, unit: "lb" as const } }],
      },
    };
    await recordFitnessTest(db, ctx, payload);
    const second = await recordFitnessTest(db, ctx, payload);
    expect(second.action).toBe("updated");

    const allRegions = await db.select().from(bodyCompositionRegions);
    expect(allRegions).toHaveLength(1); // replaced, not duplicated
    const allMeasurements = await db.select().from(bodyMeasurements);
    expect(allMeasurements).toHaveLength(1);
  });
});
