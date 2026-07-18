/**
 * Fetch adapters for the NutritionSource port (specs/05-nutrition-accuracy/SPEC.md
 * decision #8): thin HTTP shells over USDA FoodData Central and Open Food
 * Facts. All normalization is core's (pure, fixture-tested); failures degrade
 * to empty results — an external DB being down must never block a log.
 */
import { normalizeFdcFood, normalizeOffProduct, type FoodCandidate } from "@corpus/core";

const TIMEOUT_MS = 6000;
const USER_AGENT = "corpus-mcp/1.0 (personal health tracker)";

async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": USER_AGENT },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";
const OFF_BASE = "https://world.openfoodfacts.org";
const OFF_FIELDS =
  "code,product_name,product_name_en,brands,serving_size,serving_quantity,serving_quantity_unit,nutriments";

async function fdcSearch(apiKey: string, query: string, limit: number): Promise<FoodCandidate[]> {
  const params = new URLSearchParams({
    api_key: apiKey,
    query,
    pageSize: String(limit),
    dataType: "Foundation,SR Legacy,Survey (FNDDS),Branded",
  });
  const json = (await getJson(`${FDC_BASE}/foods/search?${params}`)) as {
    foods?: unknown[];
  } | null;
  return (json?.foods ?? []).flatMap((f) => {
    const c = normalizeFdcFood(f);
    return c ? [c] : [];
  });
}

async function offSearch(query: string, limit: number): Promise<FoodCandidate[]> {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: "1",
    action: "process",
    json: "1",
    page_size: String(limit),
    fields: OFF_FIELDS,
  });
  const json = (await getJson(`${OFF_BASE}/cgi/search.pl?${params}`)) as {
    products?: unknown[];
  } | null;
  return (json?.products ?? []).flatMap((p) => {
    const c = normalizeOffProduct(p);
    return c ? [c] : [];
  });
}

export interface ExternalSearchResult {
  candidates: FoodCandidate[];
  /** Which sources actually responded — lets the agent say "FDC was down". */
  sourcesQueried: string[];
}

/**
 * Query FDC (when FDC_API_KEY is configured) and Open Food Facts in parallel.
 * FDC results lead: its generic entries (Foundation/FNDDS) are authoritative
 * for whole foods, where OFF is packaged-goods-only.
 */
export async function searchExternalFoods(
  env: Env,
  query: string,
  limit = 5,
): Promise<ExternalSearchResult> {
  const sourcesQueried: string[] = [];
  const jobs: Promise<FoodCandidate[]>[] = [];
  if (env.FDC_API_KEY) {
    sourcesQueried.push("fdc");
    jobs.push(fdcSearch(env.FDC_API_KEY, query, limit));
  }
  sourcesQueried.push("off");
  jobs.push(offSearch(query, limit));
  const results = await Promise.all(jobs);
  return { candidates: results.flat().slice(0, limit * 2), sourcesQueried };
}

/** Barcode lookup: Open Food Facts first (barcode-native), FDC Branded second. */
export async function lookupBarcodeExternal(
  env: Env,
  gtin: string,
): Promise<FoodCandidate | null> {
  const off = (await getJson(
    `${OFF_BASE}/api/v2/product/${encodeURIComponent(gtin)}.json?fields=${OFF_FIELDS}`,
  )) as { status?: number; product?: unknown } | null;
  if (off?.status === 1 && off.product) {
    const c = normalizeOffProduct(off.product);
    if (c) return c;
  }
  if (env.FDC_API_KEY) {
    const params = new URLSearchParams({
      api_key: env.FDC_API_KEY,
      query: gtin,
      dataType: "Branded",
      pageSize: "1",
    });
    const json = (await getJson(`${FDC_BASE}/foods/search?${params}`)) as {
      foods?: unknown[];
    } | null;
    const first = json?.foods?.[0];
    if (first) return normalizeFdcFood(first);
  }
  return null;
}
