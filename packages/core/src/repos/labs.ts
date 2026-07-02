import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db, UserCtx } from "../db/client.js";
import {
  bodyCompositionRegions,
  bodyMeasurements,
  documents,
  fitnessTests,
  labPanels,
  labResults,
} from "../db/schema.js";
import {
  parseLabValue,
  parseRefRange,
  resolveAnalyte,
  type Comparator,
  type LabCategory,
} from "../labs/analytes.js";
import type {
  CreateDocumentUploadInput,
  RecordFitnessTestInput,
  RecordLabPanelInput,
} from "../schemas/labs.js";
import { zonedToUtc } from "../time.js";
import { toKg } from "../units.js";

export type LabPanel = typeof labPanels.$inferSelect;
export type LabResult = typeof labResults.$inferSelect;
export type FitnessTest = typeof fitnessTests.$inferSelect;
export type Document = typeof documents.$inferSelect;

function toSnake(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// --- documents ---------------------------------------------------------------

/**
 * Create a pending `documents` row and return it. The actual bytes are uploaded
 * out-of-band (worker upload route) and recorded via finalizeDocument.
 */
export async function createDocument(
  db: Db,
  ctx: UserCtx,
  input: CreateDocumentUploadInput,
): Promise<Document> {
  const safeName = input.filename.replace(/[^\w.\-]+/g, "_");
  const r2Key = `${ctx.userId}/${crypto.randomUUID()}/${safeName}`;
  const rows = await db
    .insert(documents)
    .values({
      userId: ctx.userId,
      r2Key,
      filename: input.filename,
      contentType: input.contentType,
      kind: input.kind,
      description: input.description,
      extractionStatus: "pending",
    })
    .returning();
  const doc = rows[0];
  if (!doc) throw new Error("documents insert returned no row");
  return doc;
}

export async function getDocument(
  db: Db,
  ctx: UserCtx,
  id: string,
): Promise<Document | undefined> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, ctx.userId)));
  return rows[0];
}

/** Find another of the user's documents already holding these exact bytes. */
export async function findDocumentBySha(
  db: Db,
  ctx: UserCtx,
  sha256: string,
): Promise<Document | undefined> {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, ctx.userId), eq(documents.sha256, sha256)));
  return rows[0];
}

/** Record that a document's bytes have been stored in R2. */
export async function finalizeDocument(
  db: Db,
  ctx: UserCtx,
  id: string,
  info: { sha256: string; sizeBytes: number },
): Promise<Document> {
  const rows = await db
    .update(documents)
    .set({
      sha256: info.sha256,
      sizeBytes: info.sizeBytes,
      uploadedAt: new Date(),
      extractionStatus: "extracted",
      updatedAt: new Date(),
    })
    .where(and(eq(documents.id, id), eq(documents.userId, ctx.userId)))
    .returning();
  const doc = rows[0];
  if (!doc) throw new Error(`Document ${id} not found`);
  return doc;
}

// --- lab panels --------------------------------------------------------------

export interface RecordLabPanelResult {
  panel: LabPanel;
  action: "created" | "updated";
  resultsWritten: number;
  /** Analytes whose value differed from a prior import (surfaced, not hidden). */
  changed: Array<{ analyte: string; from: string; to: string }>;
}

/**
 * Idempotent lab import (SPEC.md §5.9): the panel is keyed by accession number
 * when present, else by (source, collected_on, lab_name). Results upsert by
 * (panel, analyte). A re-import that changes an existing analyte's value is
 * applied but reported in `changed` rather than silently swallowed.
 */
export async function recordLabPanel(
  db: Db,
  ctx: UserCtx,
  input: RecordLabPanelInput,
): Promise<RecordLabPanelResult> {
  return db.transaction(async (tx) => {
    let existing: LabPanel | undefined;
    if (input.accessionNumber) {
      const rows = await tx
        .select()
        .from(labPanels)
        .where(
          and(
            eq(labPanels.userId, ctx.userId),
            eq(labPanels.source, input.source),
            eq(labPanels.accessionNumber, input.accessionNumber),
          ),
        );
      existing = rows[0];
    } else {
      const rows = await tx
        .select()
        .from(labPanels)
        .where(
          and(
            eq(labPanels.userId, ctx.userId),
            eq(labPanels.source, input.source),
            eq(labPanels.collectedOn, input.collectedOn),
            input.labName ? eq(labPanels.labName, input.labName) : isNull(labPanels.labName),
          ),
        );
      existing = rows[0];
    }

    const panelValues = {
      collectedOn: input.collectedOn,
      reportedOn: input.reportedOn,
      source: input.source,
      labName: input.labName,
      orderingProvider: input.orderingProvider,
      accessionNumber: input.accessionNumber,
      fasting: input.fasting,
      documentId: input.documentId,
      notes: input.notes,
    };

    let panel: LabPanel;
    let action: "created" | "updated";
    if (existing) {
      const rows = await tx
        .update(labPanels)
        .set({ ...panelValues, updatedAt: new Date() })
        .where(eq(labPanels.id, existing.id))
        .returning();
      panel = rows[0]!;
      action = "updated";
    } else {
      const rows = await tx
        .insert(labPanels)
        .values({ userId: ctx.userId, ...panelValues })
        .returning();
      panel = rows[0]!;
      action = "created";
    }

    // Existing results, to detect changed values on re-import.
    const priorRows = await tx
      .select({ analyte: labResults.analyte, valueText: labResults.valueText })
      .from(labResults)
      .where(eq(labResults.panelId, panel.id));
    const prior = new Map(priorRows.map((r) => [r.analyte, r.valueText]));

    const changed: RecordLabPanelResult["changed"] = [];
    for (const r of input.results) {
      const def = resolveAnalyte(r.analyte);
      const canonical = def ? def.canonical : toSnake(r.analyte);
      const category: LabCategory = r.category ?? def?.category ?? "other";
      const unit = r.unit ?? def?.unit;

      const parsed =
        r.valueNum !== undefined
          ? { valueNum: r.valueNum, comparator: (r.comparator ?? "eq") as Comparator, valueText: r.value }
          : parseLabValue(r.value);
      if (r.comparator) parsed.comparator = r.comparator;

      let refLow = r.refLow ?? null;
      let refHigh = r.refHigh ?? null;
      if (refLow === null && refHigh === null && r.refText) {
        const range = parseRefRange(r.refText);
        refLow = range.refLow;
        refHigh = range.refHigh;
      }

      const priorValue = prior.get(canonical);
      if (priorValue !== undefined && priorValue !== parsed.valueText) {
        changed.push({ analyte: canonical, from: priorValue, to: parsed.valueText });
      }

      await tx
        .insert(labResults)
        .values({
          userId: ctx.userId,
          panelId: panel.id,
          subPanel: r.subPanel,
          analyte: canonical,
          rawName: r.rawName ?? r.analyte,
          category,
          valueText: parsed.valueText,
          valueNum: parsed.valueNum ?? undefined,
          comparator: parsed.comparator,
          unit,
          refLow: refLow ?? undefined,
          refHigh: refHigh ?? undefined,
          refText: r.refText,
          flag: r.flag,
          method: r.method,
          performingLab: r.performingLab,
          note: r.note,
        })
        .onConflictDoUpdate({
          target: [labResults.panelId, labResults.analyte],
          set: {
            rawName: r.rawName ?? r.analyte,
            category,
            valueText: parsed.valueText,
            valueNum: parsed.valueNum ?? null,
            comparator: parsed.comparator,
            unit,
            refLow: refLow ?? null,
            refHigh: refHigh ?? null,
            refText: r.refText,
            flag: r.flag,
            method: r.method,
            performingLab: r.performingLab,
            note: r.note,
            subPanel: r.subPanel,
            updatedAt: new Date(),
          },
        });
    }

    return { panel, action, resultsWritten: input.results.length, changed };
  });
}

export interface LabHistoryPoint {
  collectedOn: string;
  valueText: string;
  valueNum: number | null;
  comparator: Comparator;
  unit: string | null;
  flag: string | null;
  refLow: number | null;
  refHigh: number | null;
  source: string;
}

/** Every recorded value for an analyte over time, oldest first. */
export async function getLabHistory(
  db: Db,
  ctx: UserCtx,
  analyte: string,
): Promise<LabHistoryPoint[]> {
  const def = resolveAnalyte(analyte);
  const canonical = def ? def.canonical : toSnake(analyte);
  const rows = await db
    .select({
      collectedOn: labPanels.collectedOn,
      valueText: labResults.valueText,
      valueNum: labResults.valueNum,
      comparator: labResults.comparator,
      unit: labResults.unit,
      flag: labResults.flag,
      refLow: labResults.refLow,
      refHigh: labResults.refHigh,
      source: labPanels.source,
    })
    .from(labResults)
    .innerJoin(labPanels, eq(labResults.panelId, labPanels.id))
    .where(and(eq(labResults.userId, ctx.userId), eq(labResults.analyte, canonical)))
    .orderBy(asc(labPanels.collectedOn));
  return rows.map((r) => ({
    collectedOn: r.collectedOn,
    valueText: r.valueText,
    valueNum: r.valueNum,
    comparator: r.comparator as Comparator,
    unit: r.unit,
    flag: r.flag,
    refLow: r.refLow,
    refHigh: r.refHigh,
    source: r.source,
  }));
}

// --- fitness tests -----------------------------------------------------------

export interface RecordFitnessTestResult {
  test: FitnessTest;
  action: "created" | "updated";
  bodyMeasurementId: string | null;
  regionsWritten: number;
}

/**
 * Idempotent test import keyed by (test_type, performed_on). A DEXA additionally
 * fans out its structured body composition into body_measurements (+ regional
 * detail), on one timeline with scale weigh-ins (SPEC.md §5.6).
 */
export async function recordFitnessTest(
  db: Db,
  ctx: UserCtx,
  input: RecordFitnessTestInput,
): Promise<RecordFitnessTestResult> {
  return db.transaction(async (tx) => {
    const testValues = {
      provider: input.provider,
      documentId: input.documentId,
      primaryValue: input.primaryValue,
      primaryUnit: input.primaryUnit,
      results: input.results,
      notes: input.notes,
    };

    const testRows = await tx
      .insert(fitnessTests)
      .values({
        userId: ctx.userId,
        performedOn: input.performedOn,
        testType: input.testType,
        ...testValues,
      })
      .onConflictDoUpdate({
        target: [fitnessTests.userId, fitnessTests.testType, fitnessTests.performedOn],
        set: { ...testValues, updatedAt: new Date() },
      })
      .returning();
    const test = testRows[0]!;
    const action: "created" | "updated" =
      test.createdAt.getTime() === test.updatedAt.getTime() ? "created" : "updated";

    let bodyMeasurementId: string | null = null;
    let regionsWritten = 0;

    const bc = input.bodyComposition;
    if (bc) {
      const measuredAt = zonedToUtc(input.performedOn, "12:00", ctx.timezone);
      const bmValues = {
        documentId: input.documentId,
        fitnessTestId: test.id,
        weightKg: bc.weight ? toKg(bc.weight) : undefined,
        bodyFatPct: bc.bodyFatPct,
        leanMassKg: bc.leanMass ? toKg(bc.leanMass) : undefined,
        fatMassKg: bc.fatMass ? toKg(bc.fatMass) : undefined,
        boneMineralContentKg: bc.boneMineralContent ? toKg(bc.boneMineralContent) : undefined,
        visceralFatKg: bc.visceralFat ? toKg(bc.visceralFat) : undefined,
        visceralFatRating: bc.visceralFatRating,
        androidGynoidRatio: bc.androidGynoidRatio,
        almi: bc.almi,
        ffmi: bc.ffmi,
        bmdTotalGcm2: bc.bmdTotalGcm2,
        bmdTscore: bc.bmdTscore,
        bmdZscore: bc.bmdZscore,
        bodyScore: bc.bodyScore,
      };
      const bmRows = await tx
        .insert(bodyMeasurements)
        .values({ userId: ctx.userId, measuredAt, source: "document_extraction", ...bmValues })
        .onConflictDoUpdate({
          target: [bodyMeasurements.userId, bodyMeasurements.measuredAt, bodyMeasurements.source],
          set: { ...bmValues, updatedAt: new Date() },
        })
        .returning();
      const measurement = bmRows[0]!;
      bodyMeasurementId = measurement.id;

      // Regions are children — replace wholesale so a re-import is clean.
      await tx
        .delete(bodyCompositionRegions)
        .where(eq(bodyCompositionRegions.measurementId, measurement.id));
      for (const region of bc.regions ?? []) {
        await tx.insert(bodyCompositionRegions).values({
          userId: ctx.userId,
          measurementId: measurement.id,
          region: region.region,
          side: region.side,
          leanMassKg: region.leanMass ? toKg(region.leanMass) : undefined,
          fatMassKg: region.fatMass ? toKg(region.fatMass) : undefined,
          fatPct: region.fatPct,
          bmdGcm2: region.bmdGcm2,
          bmdPercentile: region.bmdPercentile,
        });
        regionsWritten += 1;
      }
    }

    return { test, action, bodyMeasurementId, regionsWritten };
  });
}
