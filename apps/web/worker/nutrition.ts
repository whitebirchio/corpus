/**
 * Barcode lookup against Open Food Facts / USDA FDC — the web twin of
 * apps/mcp-server/src/nutrition.ts (specs/05-nutrition-accuracy/SPEC.md
 * decision #8: fetch adapters live in the workers; normalization is core's).
 * Duplicated rather than shared, same call as worker/db.ts — revisit on a
 * third adapter. Only the barcode path is needed here; text search stays a
 * chat-side (MCP) capability.
 */
import { normalizeFdcFood, normalizeOffProduct, type FoodCandidate } from "@corpus/core";

const TIMEOUT_MS = 6000;
const USER_AGENT = "corpus-web/1.0 (personal health tracker)";

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

const OFF_FIELDS =
  "code,product_name,product_name_en,brands,serving_size,serving_quantity,serving_quantity_unit,nutriments";

/** Barcode lookup: Open Food Facts first (barcode-native), FDC Branded second. */
export async function lookupBarcodeExternal(
  env: Env,
  gtin: string,
): Promise<FoodCandidate | null> {
  const off = (await getJson(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(gtin)}.json?fields=${OFF_FIELDS}`,
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
    const json = (await getJson(
      `https://api.nal.usda.gov/fdc/v1/foods/search?${params}`,
    )) as { foods?: unknown[] } | null;
    const first = json?.foods?.[0];
    if (first) return normalizeFdcFood(first);
  }
  return null;
}
