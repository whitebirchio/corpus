/**
 * Barcode scanner — the PWA's first write surface (specs/05-nutrition-accuracy
 * SPEC §5). Camera frames run through the BarcodeDetector ponyfill (zxing-wasm;
 * iOS Safari has no native detector), the GTIN resolves via
 * GET /api/foods/barcode/:gtin (catalog → OFF → FDC), and logging POSTs through
 * the same core logMeal path as chat — server-side macros, dedup included.
 * Unknown-to-catalog hits round-trip through POST /foods so the next scan of
 * that item is instant; fully unknown barcodes point back to chat + label photo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
// Bundle the decoder wasm instead of zxing-wasm's default CDN fetch: keeps the
// PWA self-contained and lets the service worker cache it like any asset.
import zxingWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

void prepareZXingModule({
  overrides: { locateFile: (path: string) => (path.endsWith(".wasm") ? zxingWasmUrl : path) },
});
import {
  api,
  type ApiFood,
  type BarcodeLookupResponse,
  type LogMealResponse,
  type MealType,
  type MeResponse,
} from "../api.js";

const DETECT_INTERVAL_MS = 250;
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

/** Nominal meal type for the current local time; always user-overridable. */
function inferMealType(): MealType {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h >= 5 && h < 10.5) return "breakfast";
  if (h >= 10.5 && h < 14) return "lunch";
  if (h >= 17 && h < 21) return "dinner";
  return "snack";
}

type Phase =
  | { kind: "scanning"; error?: string }
  | { kind: "camera_blocked"; message: string }
  | { kind: "looking_up"; gtin: string }
  | { kind: "confirm"; gtin: string; food: ApiFood; saved?: "created" | "updated" }
  | { kind: "external"; gtin: string; result: Extract<BarcodeLookupResponse, { status: "external" }> }
  | { kind: "not_found"; gtin: string }
  | { kind: "duplicate"; retry: () => Promise<LogMealResponse>; candidates: Array<{ description: string; calories: number }> }
  | { kind: "logged"; summary: string }
  | { kind: "error"; message: string };

export function Scan({ me }: { me: MeResponse }) {
  const [phase, setPhase] = useState<Phase>({ kind: "scanning" });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const lookUp = useCallback(
    async (gtin: string) => {
      stopCamera();
      setPhase({ kind: "looking_up", gtin });
      try {
        const result = await api.barcodeLookup(gtin);
        if (result.status === "catalog") setPhase({ kind: "confirm", gtin, food: result.food });
        else if (result.status === "external") setPhase({ kind: "external", gtin, result });
        else setPhase({ kind: "not_found", gtin });
      } catch (e) {
        setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [stopCamera],
  );

  // Camera + detection loop, active only while scanning.
  useEffect(() => {
    if (phase.kind !== "scanning") return;
    let cancelled = false;
    const detector = new BarcodeDetector({ formats: [...FORMATS] });
    let timer: ReturnType<typeof setInterval> | undefined;

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        timer = setInterval(() => {
          void (async () => {
            if (busyRef.current || !videoRef.current || videoRef.current.readyState < 2) return;
            busyRef.current = true;
            try {
              const codes = await detector.detect(videoRef.current);
              const raw = codes[0]?.rawValue;
              if (raw && /^\d{8,14}$/.test(raw) && !cancelled) {
                clearInterval(timer);
                await lookUp(raw);
              }
            } catch {
              // transient decode errors are expected between frames
            } finally {
              busyRef.current = false;
            }
          })();
        }, DETECT_INTERVAL_MS);
      } catch {
        if (!cancelled) {
          setPhase({
            kind: "camera_blocked",
            message: "Camera unavailable — allow camera access for this site and retry.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stopCamera();
    };
  }, [phase.kind, lookUp, stopCamera]);

  const rescan = () => setPhase({ kind: "scanning" });

  return (
    <div className="scan">
      {phase.kind === "scanning" && (
        <div className="card">
          <h2>Scan a barcode</h2>
          <div className="scan-viewport">
            {/* playsInline keeps iOS from hijacking into fullscreen */}
            <video ref={videoRef} playsInline muted />
            <div className="scan-reticle" />
          </div>
          <p className="empty-note">Point at the UPC/EAN on the package.</p>
        </div>
      )}

      {phase.kind === "camera_blocked" && (
        <Notice message={phase.message} actionLabel="Retry" onAction={rescan} />
      )}

      {phase.kind === "looking_up" && <div className="center-note">Looking up {phase.gtin}…</div>}

      {phase.kind === "confirm" && (
        <ConfirmCard
          key={phase.gtin}
          food={phase.food}
          saved={phase.saved}
          onLogged={(summary) => setPhase({ kind: "logged", summary })}
          onDuplicate={(retry, candidates) => setPhase({ kind: "duplicate", retry, candidates })}
          onError={(message) => setPhase({ kind: "error", message })}
          onCancel={rescan}
        />
      )}

      {phase.kind === "external" && (
        <ExternalCard
          gtin={phase.gtin}
          result={phase.result}
          onSaved={(food, saved) => setPhase({ kind: "confirm", gtin: phase.gtin, food, saved })}
          onError={(message) => setPhase({ kind: "error", message })}
          onCancel={rescan}
        />
      )}

      {phase.kind === "not_found" && (
        <Notice
          message={`No source knows barcode ${phase.gtin}. Add it in chat with Claude — a photo of the nutrition label is enough — and the next scan will be instant.`}
          actionLabel="Scan another"
          onAction={rescan}
        />
      )}

      {phase.kind === "duplicate" && (
        <div className="card">
          <h2>Looks already logged</h2>
          {phase.candidates.map((cand, i) => (
            <p key={i} className="empty-note">
              {cand.description} — {Math.round(cand.calories)} kcal
            </p>
          ))}
          <div className="scan-actions">
            <button
              className="google-button"
              onClick={() => {
                void phase
                  .retry()
                  .then((r) =>
                    r.status === "logged"
                      ? setPhase({ kind: "logged", summary: mealSummary(r) })
                      : setPhase({ kind: "error", message: "Still flagged as duplicate" }),
                  )
                  .catch((e) =>
                    setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) }),
                  );
              }}
            >
              Log anyway
            </button>
            <button className="subtle-button" onClick={rescan}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase.kind === "logged" && (
        <Notice message={phase.summary} actionLabel="Scan another" onAction={rescan} />
      )}

      {phase.kind === "error" && (
        <Notice message={phase.message} actionLabel="Try again" onAction={rescan} />
      )}

      {/* timezone comes from the session; logMeal defaults the date to today there */}
      <p className="empty-note scan-tz">Logging for today ({me.today}).</p>
    </div>
  );
}

function mealSummary(r: Extract<LogMealResponse, { status: "logged" }>): string {
  return `Logged: ${r.meal.description} — ${Math.round(r.meal.calories)} kcal, ${Math.round(r.meal.proteinG)}g protein.`;
}

function Notice(props: { message: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="card">
      <p className="empty-note">{props.message}</p>
      <button className="google-button" onClick={props.onAction}>
        {props.actionLabel}
      </button>
    </div>
  );
}

/** Catalog food confirmed on screen: portion × quantity, meal type, log. */
function ConfirmCard(props: {
  food: ApiFood;
  saved?: "created" | "updated";
  onLogged: (summary: string) => void;
  onDuplicate: (
    retry: () => Promise<LogMealResponse>,
    candidates: Array<{ description: string; calories: number }>,
  ) => void;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const { food } = props;
  const hasPortions = food.portions.length > 0;
  const [portionIdx, setPortionIdx] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [grams, setGrams] = useState(100);
  const [mealType, setMealType] = useState<MealType>(inferMealType());
  const [posting, setPosting] = useState(false);

  const portion = hasPortions ? food.portions[Math.min(portionIdx, food.portions.length - 1)] : undefined;
  // Display-only preview; the authoritative macros are computed server-side on log.
  const kcal = portion
    ? portion.macros.calories * quantity
    : (food.per100g.calories * grams) / 100;
  const protein = portion
    ? portion.macros.proteinG * quantity
    : (food.per100g.proteinG * grams) / 100;

  const submit = (allowDuplicate: boolean): Promise<LogMealResponse> =>
    api.logMeal({
      mealType,
      description: food.name,
      items: [
        portion
          ? {
              name: food.name,
              foodId: food.id,
              portionLabel: portion.label,
              quantity,
              unitNote: `${quantity} × ${portion.label}`,
            }
          : { name: food.name, foodId: food.id, grams, unitNote: `${grams} g` },
      ],
      ...(allowDuplicate ? { allowDuplicate: true } : {}),
    });

  const log = async () => {
    setPosting(true);
    try {
      const r = await submit(false);
      if (r.status === "logged") props.onLogged(mealSummary(r));
      else
        props.onDuplicate(
          () => submit(true),
          r.candidates.map((cand) => ({ description: cand.description, calories: cand.calories })),
        );
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="card">
      <h2>
        {food.name}
        {food.verified && <span className="status-chip">verified</span>}
      </h2>
      {food.brand && <p className="empty-note">{food.brand}</p>}
      {props.saved && (
        <p className="empty-note">Saved to your catalog — future scans resolve instantly.</p>
      )}

      {portion ? (
        <div className="scan-field">
          <label>
            Portion
            <select value={portionIdx} onChange={(e) => setPortionIdx(Number(e.target.value))}>
              {food.portions.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label} ({p.grams} g)
                </option>
              ))}
            </select>
          </label>
          <div className="scan-stepper">
            <button onClick={() => setQuantity((q) => Math.max(0.5, q - 0.5))}>−</button>
            <span>{quantity}</span>
            <button onClick={() => setQuantity((q) => q + 0.5)}>+</button>
          </div>
        </div>
      ) : (
        <div className="scan-field">
          <label>
            Grams
            <input
              type="number"
              min={1}
              value={grams}
              onChange={(e) => setGrams(Math.max(1, Number(e.target.value) || 0))}
            />
          </label>
        </div>
      )}

      <div className="scan-field">
        <label>
          Meal
          <select value={mealType} onChange={(e) => setMealType(e.target.value as MealType)}>
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
            <option value="snack">Snack</option>
          </select>
        </label>
      </div>

      <p className="hero-caption">
        ≈ {Math.round(kcal)} kcal · {Math.round(protein)}g protein
      </p>

      <div className="scan-actions">
        <button className="google-button" disabled={posting} onClick={() => void log()}>
          {posting ? "Logging…" : "Log it"}
        </button>
        <button className="subtle-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** External DB hit: save to the catalog (with the scanned barcode), then confirm. */
function ExternalCard(props: {
  gtin: string;
  result: Extract<BarcodeLookupResponse, { status: "external" }>;
  onSaved: (food: ApiFood, saved: "created" | "updated") => void;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const { candidate } = props.result;
  const [saving, setSaving] = useState(false);
  const sourceName = candidate.source === "fdc" ? "USDA FoodData Central" : "Open Food Facts";

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.upsertFood({
        canonicalName: candidate.name,
        brand: candidate.brand,
        barcode: props.gtin,
        per100g: candidate.per100g,
        portions: candidate.portions,
        source: candidate.source,
        sourceRef: candidate.sourceRef,
        // FDC branded data is label-derived; OFF is crowd-sourced — leave it
        // unverified until checked against a real label.
        verified: candidate.source === "fdc",
      });
      props.onSaved(r.food, r.status);
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <h2>{candidate.name}</h2>
      <p className="empty-note">
        {candidate.brand ? `${candidate.brand} · ` : ""}
        Found in {sourceName} — not in your catalog yet.
      </p>
      <p className="hero-caption">
        {Math.round(candidate.per100g.calories)} kcal · {Math.round(candidate.per100g.proteinG)}g
        protein per 100 g
      </p>
      <div className="scan-actions">
        <button className="google-button" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save to catalog & log"}
        </button>
        <button className="subtle-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
