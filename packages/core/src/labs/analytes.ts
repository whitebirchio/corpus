/**
 * Canonical analyte dictionary + value/range parsers (specs/01-initial-platform/SPEC.md §5.6).
 *
 * Lab reports print the same analyte under wildly varying names; we store a
 * canonical snake_case `analyte` so trends are one WHERE clause. The dictionary
 * maps normalized printed names to canonical ones and supplies the category +
 * preferred unit. Seeded from the real Function Health panel (Appendix A) plus
 * common extras; the agent may still record analytes not listed here (they're
 * accepted, just uncategorized), mirroring the movement-catalog approach.
 */

export type LabCategory =
  | "lipids"
  | "cardio_advanced"
  | "metabolic"
  | "cbc"
  | "hormones"
  | "thyroid"
  | "vitamins_minerals"
  | "inflammation"
  | "autoimmune"
  | "urinalysis"
  | "heavy_metals"
  | "other";

export type Comparator = "eq" | "lt" | "gt" | "le" | "ge";

export interface AnalyteDef {
  /** canonical snake_case key, e.g. "ldl_cholesterol" */
  canonical: string;
  display: string;
  category: LabCategory;
  unit?: string;
  /** additional printed-name variants (beyond the display name) to match on */
  aliases?: string[];
}

const A = (
  canonical: string,
  display: string,
  category: LabCategory,
  unit?: string,
  aliases?: string[],
): AnalyteDef => ({ canonical, display, category, unit, aliases });

export const ANALYTES: AnalyteDef[] = [
  // --- lipids ---
  A("cholesterol_total", "Cholesterol, Total", "lipids", "mg/dL", ["total cholesterol"]),
  A("hdl_cholesterol", "HDL Cholesterol", "lipids", "mg/dL", ["hdl"]),
  A("ldl_cholesterol", "LDL Cholesterol", "lipids", "mg/dL", ["ldl", "ldl c", "ldl cholesterol calc"]),
  A("triglycerides", "Triglycerides", "lipids", "mg/dL", ["trig"]),
  A("non_hdl_cholesterol", "Non-HDL Cholesterol", "lipids", "mg/dL"),
  A("cholesterol_hdl_ratio", "Cholesterol/HDL Ratio", "lipids", "ratio", ["chol hdlc ratio", "chol hdl ratio"]),
  A("vldl_cholesterol", "VLDL Cholesterol", "lipids", "mg/dL"),

  // --- advanced cardiovascular ---
  A("apolipoprotein_b", "Apolipoprotein B", "cardio_advanced", "mg/dL", ["apob", "apo b"]),
  A("lipoprotein_a", "Lipoprotein (a)", "cardio_advanced", "nmol/L", ["lp a", "lpa"]),
  A("omega_check", "OmegaCheck", "cardio_advanced", "% by wt", ["omegacheck"]),
  A("ldl_particle_number", "LDL Particle Number", "cardio_advanced", "nmol/L", ["ldl p", "ldl particle"]),
  A("hdl_particle_number", "HDL Particle Number", "cardio_advanced", "umol/L", ["hdl p"]),
  A("small_ldl_particle_number", "Small LDL Particle Number", "cardio_advanced", "nmol/L", ["small ldl p"]),
  A("ldl_peak_size", "LDL Peak Size", "cardio_advanced", "angstrom"),

  // --- metabolic / CMP ---
  A("glucose", "Glucose", "metabolic", "mg/dL", ["glucose fasting"]),
  A("urea_nitrogen", "Urea Nitrogen (BUN)", "metabolic", "mg/dL", ["bun", "urea nitrogen"]),
  A("creatinine", "Creatinine", "metabolic", "mg/dL"),
  A("egfr", "eGFR", "metabolic", "mL/min/1.73m2", ["egfr", "estimated gfr"]),
  A("bun_creatinine_ratio", "BUN/Creatinine Ratio", "metabolic", "ratio"),
  A("sodium", "Sodium", "metabolic", "mmol/L"),
  A("potassium", "Potassium", "metabolic", "mmol/L"),
  A("chloride", "Chloride", "metabolic", "mmol/L"),
  A("carbon_dioxide", "Carbon Dioxide", "metabolic", "mmol/L", ["co2", "bicarbonate"]),
  A("calcium", "Calcium", "metabolic", "mg/dL"),
  A("protein_total", "Protein, Total", "metabolic", "g/dL", ["total protein"]),
  A("albumin", "Albumin", "metabolic", "g/dL"),
  A("globulin", "Globulin", "metabolic", "g/dL"),
  A("albumin_globulin_ratio", "Albumin/Globulin Ratio", "metabolic", "ratio", ["a g ratio"]),
  A("bilirubin_total", "Bilirubin, Total", "metabolic", "mg/dL", ["total bilirubin"]),
  A("alkaline_phosphatase", "Alkaline Phosphatase", "metabolic", "U/L", ["alp"]),
  A("ast", "AST", "metabolic", "U/L", ["ast sgot", "aspartate aminotransferase"]),
  A("alt", "ALT", "metabolic", "U/L", ["alt sgpt", "alanine aminotransferase"]),
  A("ggt", "GGT", "metabolic", "U/L", ["gamma glutamyl transferase"]),
  A("uric_acid", "Uric Acid", "metabolic", "mg/dL"),
  A("amylase", "Amylase", "metabolic", "U/L"),
  A("lipase", "Lipase", "metabolic", "U/L"),
  A("hemoglobin_a1c", "Hemoglobin A1c", "metabolic", "%", ["a1c", "hba1c", "hemoglobin a1c"]),
  A("insulin", "Insulin", "metabolic", "uIU/mL", ["fasting insulin"]),
  A("homocysteine", "Homocysteine", "metabolic", "umol/L"),
  A("leptin", "Leptin", "metabolic", "ng/mL"),
  A("methylmalonic_acid", "Methylmalonic Acid", "metabolic", "nmol/L", ["mma"]),

  // --- CBC ---
  A("wbc", "White Blood Cell Count", "cbc", "10^3/uL", ["white blood cell count", "wbc count"]),
  A("rbc", "Red Blood Cell Count", "cbc", "10^6/uL", ["red blood cell count", "rbc count"]),
  A("hemoglobin", "Hemoglobin", "cbc", "g/dL", ["hgb"]),
  A("hematocrit", "Hematocrit", "cbc", "%", ["hct"]),
  A("mcv", "MCV", "cbc", "fL"),
  A("mch", "MCH", "cbc", "pg"),
  A("mchc", "MCHC", "cbc", "g/dL"),
  A("rdw", "RDW", "cbc", "%"),
  A("platelet_count", "Platelet Count", "cbc", "10^3/uL", ["platelets", "plt"]),
  A("mpv", "MPV", "cbc", "fL"),
  A("absolute_neutrophils", "Absolute Neutrophils", "cbc", "cells/uL"),
  A("absolute_lymphocytes", "Absolute Lymphocytes", "cbc", "cells/uL"),
  A("absolute_monocytes", "Absolute Monocytes", "cbc", "cells/uL"),
  A("absolute_eosinophils", "Absolute Eosinophils", "cbc", "cells/uL"),
  A("absolute_basophils", "Absolute Basophils", "cbc", "cells/uL"),
  A("neutrophils_pct", "Neutrophils %", "cbc", "%", ["neutrophils"]),
  A("lymphocytes_pct", "Lymphocytes %", "cbc", "%", ["lymphocytes"]),
  A("monocytes_pct", "Monocytes %", "cbc", "%", ["monocytes"]),
  A("eosinophils_pct", "Eosinophils %", "cbc", "%", ["eosinophils"]),
  A("basophils_pct", "Basophils %", "cbc", "%", ["basophils"]),

  // --- hormones ---
  A("testosterone_total", "Testosterone, Total", "hormones", "ng/dL", ["testosterone total ms", "total testosterone"]),
  A("testosterone_free", "Testosterone, Free", "hormones", "pg/mL", ["free testosterone"]),
  A("estradiol", "Estradiol", "hormones", "pg/mL", ["e2"]),
  A("shbg", "Sex Hormone Binding Globulin", "hormones", "nmol/L", ["sex hormone binding globulin"]),
  A("dhea_sulfate", "DHEA Sulfate", "hormones", "mcg/dL", ["dhea s", "dhea sulfate"]),
  A("fsh", "FSH", "hormones", "mIU/mL", ["follicle stimulating hormone"]),
  A("lh", "LH", "hormones", "mIU/mL", ["luteinizing hormone"]),
  A("prolactin", "Prolactin", "hormones", "ng/mL"),
  A("cortisol_total", "Cortisol, Total", "hormones", "mcg/dL", ["cortisol"]),
  A("psa_total", "PSA, Total", "hormones", "ng/mL", ["psa total", "prostate specific antigen"]),
  A("psa_free", "PSA, Free", "hormones", "ng/mL", ["psa free"]),
  A("psa_free_pct", "PSA, % Free", "hormones", "%", ["psa free pct", "percent free psa"]),

  // --- thyroid ---
  A("tsh", "TSH", "thyroid", "mIU/L", ["thyroid stimulating hormone"]),
  A("free_t4", "Free T4", "thyroid", "ng/dL", ["t4 free", "free thyroxine"]),
  A("free_t3", "Free T3", "thyroid", "pg/mL", ["t3 free"]),
  A("tpo_antibodies", "Thyroid Peroxidase Antibodies", "thyroid", "IU/mL", ["thyroid peroxidase antibodies", "tpo ab", "anti tpo"]),
  A("thyroglobulin_antibodies", "Thyroglobulin Antibodies", "thyroid", "IU/mL", ["tg ab"]),

  // --- vitamins & minerals ---
  A("vitamin_d_25oh", "Vitamin D, 25-OH, Total", "vitamins_minerals", "ng/mL", ["vitamin d 25 oh total ia", "vitamin d", "25 oh vitamin d", "vitamin d 25 hydroxy"]),
  A("vitamin_b12", "Vitamin B12", "vitamins_minerals", "pg/mL", ["b12", "cobalamin"]),
  A("folate", "Folate", "vitamins_minerals", "ng/mL", ["folic acid"]),
  A("zinc", "Zinc", "vitamins_minerals", "mcg/dL"),
  A("magnesium_rbc", "Magnesium, RBC", "vitamins_minerals", "mg/dL", ["magnesium rbc", "rbc magnesium"]),
  A("ferritin", "Ferritin", "vitamins_minerals", "ng/mL"),
  A("iron_total", "Iron, Total", "vitamins_minerals", "mcg/dL", ["iron total", "iron"]),
  A("tibc", "Iron Binding Capacity (TIBC)", "vitamins_minerals", "mcg/dL", ["iron binding capacity", "total iron binding capacity"]),
  A("iron_saturation", "Iron Saturation", "vitamins_minerals", "%", ["saturation", "pct saturation", "transferrin saturation"]),

  // --- inflammation ---
  A("hs_crp", "hs-CRP", "inflammation", "mg/L", ["hs crp", "high sensitivity crp", "c reactive protein"]),

  // --- autoimmune ---
  A("ana_screen", "ANA Screen, IFA", "autoimmune", undefined, ["ana screen ifa", "ana"]),
  A("rheumatoid_factor", "Rheumatoid Factor", "autoimmune", "IU/mL", ["rf"]),

  // --- heavy metals ---
  A("mercury_blood", "Mercury, Blood", "heavy_metals", "mcg/L", ["mercury blood", "blood mercury"]),
  A("lead_venous", "Lead (Venous)", "heavy_metals", "mcg/dL", ["lead venous", "blood lead"]),

  // --- urinalysis ---
  A("urine_color", "Color", "urinalysis", undefined, ["color"]),
  A("urine_appearance", "Appearance", "urinalysis", undefined, ["appearance"]),
  A("urine_specific_gravity", "Specific Gravity", "urinalysis", undefined, ["specific gravity"]),
  A("urine_ph", "pH", "urinalysis", undefined, ["ph"]),
  A("urine_glucose", "Urine Glucose", "urinalysis"),
  A("urine_bilirubin", "Urine Bilirubin", "urinalysis"),
  A("urine_ketones", "Ketones", "urinalysis", undefined, ["ketones"]),
  A("urine_occult_blood", "Occult Blood", "urinalysis", undefined, ["occult blood"]),
  A("urine_protein", "Urine Protein", "urinalysis"),
  A("urine_nitrite", "Nitrite", "urinalysis", undefined, ["nitrite"]),
  A("urine_leukocyte_esterase", "Leukocyte Esterase", "urinalysis", undefined, ["leukocyte esterase"]),
  A("urine_wbc", "Urine WBC", "urinalysis", "/HPF"),
  A("urine_rbc", "Urine RBC", "urinalysis", "/HPF"),
  A("urine_squamous_epithelial_cells", "Squamous Epithelial Cells", "urinalysis", "/HPF", ["squamous epithelial cells"]),
  A("urine_bacteria", "Bacteria", "urinalysis", "/HPF", ["bacteria"]),
  A("albumin_urine", "Albumin, Urine", "urinalysis", "mg/dL", ["albumin urine", "urine albumin", "microalbumin"]),
];

/** Normalize a printed analyte name for matching. */
export function normalizeAnalyteName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // drop parentheticals like "(calc)"
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_NORMALIZED = new Map<string, AnalyteDef>();
for (const def of ANALYTES) {
  BY_NORMALIZED.set(def.canonical.replace(/_/g, " "), def);
  BY_NORMALIZED.set(normalizeAnalyteName(def.display), def);
  for (const alias of def.aliases ?? []) BY_NORMALIZED.set(normalizeAnalyteName(alias), def);
}
const BY_CANONICAL = new Map(ANALYTES.map((d) => [d.canonical, d]));

/** Look up an analyte by canonical key. */
export function getAnalyte(canonical: string): AnalyteDef | undefined {
  return BY_CANONICAL.get(canonical);
}

/**
 * Resolve a printed name (or a canonical key) to a dictionary entry. Returns
 * undefined for analytes not in the dictionary — callers accept those as-is.
 */
export function resolveAnalyte(name: string): AnalyteDef | undefined {
  return BY_CANONICAL.get(name) ?? BY_NORMALIZED.get(normalizeAnalyteName(name));
}

export interface ParsedValue {
  valueText: string;
  valueNum: number | null;
  comparator: Comparator;
}

/**
 * Parse a printed result value into { text, num, comparator }. Handles plain
 * numbers ("168"), censored values ("<10", "> OR = 40"), and qualitative
 * strings ("NEGATIVE", "NONE SEEN") which yield valueNum null / comparator eq.
 */
export function parseLabValue(raw: string): ParsedValue {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const hasLt = text.includes("<");
  const hasGt = text.includes(">");
  const hasEq = text.includes("=") || /\bor\s*=/.test(lower) || text.includes("≤") || text.includes("≥");
  const hasLe = text.includes("≤");
  const hasGe = text.includes("≥");

  const numMatch = text.match(/-?\d+(?:\.\d+)?/);
  const valueNum = numMatch ? Number.parseFloat(numMatch[0]) : null;

  let comparator: Comparator = "eq";
  if (valueNum !== null) {
    if (hasLe || (hasLt && hasEq)) comparator = "le";
    else if (hasGe || (hasGt && hasEq)) comparator = "ge";
    else if (hasLt) comparator = "lt";
    else if (hasGt) comparator = "gt";
  }

  return { valueText: text, valueNum, comparator };
}

export interface ParsedRange {
  refLow: number | null;
  refHigh: number | null;
}

/**
 * Parse a printed reference range into numeric bounds when it's a plain
 * interval or one-sided bound; otherwise returns nulls (keep the verbatim
 * ref_text). Examples: "250-425" -> {250,425}; "<200" -> {high:200};
 * "> OR = 40" -> {low:40}.
 */
export function parseRefRange(raw: string): ParsedRange {
  const text = raw.trim();
  const interval = text.match(/^(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)$/);
  if (interval) {
    return { refLow: Number.parseFloat(interval[1]!), refHigh: Number.parseFloat(interval[2]!) };
  }
  const num = text.match(/-?\d+(?:\.\d+)?/);
  if (!num) return { refLow: null, refHigh: null };
  const value = Number.parseFloat(num[0]);
  const lower = text.toLowerCase();
  if (text.includes("<") || (text.includes("=") && lower.includes("<")) || /less than/.test(lower)) {
    return { refLow: null, refHigh: value };
  }
  if (text.includes(">") || /greater than|\bor\s*=/.test(lower)) {
    return { refLow: value, refHigh: null };
  }
  return { refLow: null, refHigh: null };
}
