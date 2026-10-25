/**
 * Garmin sync endpoints (ADR-014). Not part of the MCP surface — these
 * serve the nightly GitHub Actions job (apps/garmin-sync), authenticated by a
 * shared secret (GARMIN_INGEST_SECRET, a Worker secret mirrored in the repo's
 * Actions secrets).
 *
 *   GET  /garmin/tokens?user=<email>  → stored session token blob (or null)
 *   PUT  /garmin/tokens?user=<email>  → store/rotate the token blob
 *   POST /garmin/ingest               → { userEmail, days, activities,
 *                                         weighIns? } → import summary
 *                                       (weighIns: ADR-026)
 *
 * The token store lets the stateless Actions runner reuse Garmin's refreshed
 * session across runs — only the very first login (or a revoked refresh
 * token) needs Scott's interactive bootstrap. Garmin credentials themselves
 * never touch this worker; only the client's serialized token JSON does.
 */
import { findOrCreateUser, garminIngestPayload, importGarminData } from "@corpus/core";
import { withAuthDb, withUserDb } from "./db.js";

const TOKENS_KEY_PREFIX = "garmin-tokens:";
/** ISO time of the last successful ingest — read by get_daily_summary to flag a stalled sync. */
export const LAST_INGEST_KEY_PREFIX = "garmin-last-ingest:";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Constant-time-ish bearer check; length is the only thing that can leak. */
function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "");
  const enc = new TextEncoder();
  const a = enc.encode(presented);
  const b = enc.encode(secret);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function allowedEmail(env: Env, email: string | null): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const allowed = env.ALLOWED_EMAILS.split(",").map((e: string) => e.trim().toLowerCase());
  return allowed.includes(normalized) ? normalized : null;
}

export async function handleGarmin(request: Request, env: Env): Promise<Response> {
  const secret = env.GARMIN_INGEST_SECRET;
  if (!secret) {
    return json({ error: "GARMIN_INGEST_SECRET is not configured on this worker" }, 503);
  }
  if (!authorized(request, secret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);

  if (url.pathname === "/garmin/tokens") {
    const email = allowedEmail(env, url.searchParams.get("user"));
    if (!email) return json({ error: "Unknown user" }, 403);
    const key = `${TOKENS_KEY_PREFIX}${email}`;

    if (request.method === "GET") {
      const tokens = await env.OAUTH_KV.get(key);
      return json({ tokens });
    }
    if (request.method === "PUT") {
      const body = (await request.json().catch(() => null)) as { tokens?: unknown } | null;
      if (!body || typeof body.tokens !== "string" || body.tokens.length === 0) {
        return json({ error: "Body must be { tokens: string }" }, 400);
      }
      await env.OAUTH_KV.put(key, body.tokens);
      return json({ ok: true });
    }
    return json({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/garmin/ingest" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: "Invalid JSON body" }, 400);

    const email = allowedEmail(
      env,
      typeof body.userEmail === "string" ? body.userEmail : null,
    );
    if (!email) return json({ error: "Unknown user" }, 403);

    const parsed = garminIngestPayload.safeParse(body);
    if (!parsed.success) {
      return json({ error: "Invalid payload", issues: parsed.error.issues }, 400);
    }

    // Uncaught, a DB error (e.g. a stalled Neon connection) surfaces as an
    // opaque Cloudflare 1101 HTML page. Catch it: log the stage + stack to
    // Workers Logs and hand the sync job a structured 500 it can retry —
    // every payload is idempotent, so a retry is always safe.
    let stage = "user_lookup";
    const started = Date.now();
    try {
      const user = await withAuthDb(env, email, (db) =>
        findOrCreateUser(db, email, email.split("@")[0]!, env.DEFAULT_TIMEZONE),
      );
      const ctx = {
        userId: user.id,
        timezone: user.timezone,
        unitPreference: user.unitPreference,
      };
      stage = "import";
      const summary = await withUserDb(env, user.id, (db) =>
        importGarminData(db, ctx, parsed.data),
      );
      console.log(
        JSON.stringify({
          event: "garmin_ingest_ok",
          ms: Date.now() - started,
          days: summary.days.updated.length,
          weighIns: summary.weighIns.upserted.length,
          weighInsDeleted: summary.weighIns.deleted,
        }),
      );
      try {
        await env.OAUTH_KV.put(`${LAST_INGEST_KEY_PREFIX}${email}`, new Date().toISOString());
      } catch (e) {
        // The data landed; a missed health stamp must not fail the ingest.
        console.error(JSON.stringify({ event: "garmin_last_ingest_stamp_failed", error: String(e) }));
      }
      return json(summary);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({
          event: "garmin_ingest_failed",
          stage,
          ms: Date.now() - started,
          error: message,
          stack: e instanceof Error ? e.stack : undefined,
        }),
      );
      return json({ error: "Ingest failed", stage, message }, 500);
    }
  }

  return json({ error: "Not found" }, 404);
}
