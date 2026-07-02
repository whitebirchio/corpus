/**
 * Zod input schemas for the Phase 2 lab/test/document tools (SPEC.md §6.1).
 */
import { z } from "zod";
import { localDate, massValue } from "./inputs.js";

// --- record_lab_panel --------------------------------------------------------

export const labResultInput = z.object({
  analyte: z
    .string()
    .min(1)
    .describe("Canonical snake_case name when known (e.g. 'ldl_cholesterol'); otherwise the printed name — it will be resolved against the analyte dictionary."),
  rawName: z.string().optional().describe("The analyte name exactly as printed on the report"),
  category: z
    .enum([
      "lipids",
      "cardio_advanced",
      "metabolic",
      "cbc",
      "hormones",
      "thyroid",
      "vitamins_minerals",
      "inflammation",
      "autoimmune",
      "urinalysis",
      "heavy_metals",
      "other",
    ])
    .optional()
    .describe("Optional; filled from the dictionary when omitted"),
  subPanel: z.string().optional().describe("Grouping as printed, e.g. 'Lipid Panel', 'CMP'"),
  value: z
    .string()
    .min(1)
    .describe("The result value VERBATIM as printed: '168', '<10', 'NEGATIVE', 'NONE SEEN'"),
  valueNum: z.number().optional().describe("Override; parsed from value when omitted"),
  comparator: z.enum(["eq", "lt", "gt", "le", "ge"]).optional(),
  unit: z.string().optional().describe("Filled from the dictionary when omitted"),
  refLow: z.number().optional(),
  refHigh: z.number().optional(),
  refText: z.string().optional().describe("Reference range verbatim, e.g. '<200', 'See Note'"),
  flag: z.enum(["normal", "low", "high", "critical", "abnormal"]).optional(),
  method: z.string().optional(),
  performingLab: z.string().optional(),
  note: z.string().optional(),
});

export const recordLabPanelShape = {
  collectedOn: localDate.describe("Specimen collection date"),
  reportedOn: localDate.optional(),
  source: z.enum(["function_health", "pcp", "dexafit", "other"]),
  labName: z.string().optional().describe("Performing lab, e.g. 'Quest'"),
  orderingProvider: z.string().optional(),
  accessionNumber: z
    .string()
    .optional()
    .describe("Accession/order number if printed — the strongest dedup key for re-imports"),
  fasting: z.boolean().optional(),
  documentId: z.uuid().optional().describe("Link to a stored original (from create_document_upload)"),
  notes: z.string().optional(),
  results: z.array(labResultInput).min(1),
};
export const recordLabPanelInput = z.object(recordLabPanelShape);
export type RecordLabPanelInput = z.infer<typeof recordLabPanelInput>;

// --- record_fitness_test -----------------------------------------------------

export const dexaRegionInput = z.object({
  region: z.enum(["total", "arm", "leg", "trunk", "head", "ribs", "spine", "pelvis", "android", "gynoid"]),
  side: z.enum(["left", "right", "both"]).optional(),
  leanMass: massValue.optional(),
  fatMass: massValue.optional(),
  fatPct: z.number().optional(),
  bmdGcm2: z.number().optional().describe("Regional bone mineral density, g/cm^2"),
  bmdPercentile: z.number().optional(),
});

export const bodyCompositionInput = z.object({
  weight: massValue.optional(),
  bodyFatPct: z.number().optional(),
  leanMass: massValue.optional(),
  fatMass: massValue.optional(),
  boneMineralContent: massValue.optional(),
  visceralFat: massValue.optional().describe("Visceral fat mass"),
  visceralFatRating: z.number().optional(),
  androidGynoidRatio: z.number().optional(),
  almi: z.number().optional().describe("Appendicular lean mass index, kg/m^2"),
  ffmi: z.number().optional().describe("Fat-free mass index, kg/m^2"),
  bmdTotalGcm2: z.number().optional(),
  bmdTscore: z.number().optional(),
  bmdZscore: z.number().optional(),
  bodyScore: z.string().optional().describe("Provider grade, e.g. 'C+'"),
  regions: z.array(dexaRegionInput).optional().describe("Per-region L/R detail (DEXA)"),
});

export const recordFitnessTestShape = {
  performedOn: localDate,
  testType: z.enum(["vo2max", "rmr", "dexa", "other"]),
  provider: z.string().optional().describe("e.g. 'DexaFit Nashua'"),
  documentId: z.uuid().optional(),
  primaryValue: z.number().optional().describe("Headline number, e.g. 47 (VO2 max), 2144 (RMR kcal/day)"),
  primaryUnit: z.string().optional().describe("e.g. 'ml/kg/min', 'kcal/day'"),
  results: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Test-type-specific detail (see corpus://schema). vo2max: {biological_age,max_hr,vt1_bpm,vt2_bpm,training_zones,redline_ratio,lean_vo2max,leg_lean_vo2max}; rmr: {rmr_kcal,rer,fuel_fat_pct,fuel_carb_pct,predicted_rmr,tdee_by_activity}",
    ),
  bodyComposition: bodyCompositionInput
    .optional()
    .describe("DEXA only — fans out to body measurements + regional detail"),
  notes: z.string().optional(),
};
export const recordFitnessTestInput = z.object(recordFitnessTestShape);
export type RecordFitnessTestInput = z.infer<typeof recordFitnessTestInput>;

// --- create_document_upload --------------------------------------------------

export const createDocumentUploadShape = {
  filename: z.string().min(1),
  contentType: z.string().min(1).describe("MIME type, e.g. 'application/pdf', 'image/jpeg'"),
  kind: z.enum([
    "lab_report",
    "dexa_report",
    "fitness_test",
    "meal_photo",
    "export",
    "screenshot",
    "other",
  ]),
  description: z.string().optional(),
};
export const createDocumentUploadInput = z.object(createDocumentUploadShape);
export type CreateDocumentUploadInput = z.infer<typeof createDocumentUploadInput>;
