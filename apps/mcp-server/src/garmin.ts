/**
 * Garmin sync endpoints (SPEC.md §8.4). Not part of the MCP surface — these
 * serve the nightly GitHub Actions job (apps/garmin-sync), authenticated by a
 * shared secret (GARMIN_INGEST_SECRET, a Worker secret mirrored in the repo's
 * Actions secrets).
 *
 *   GET  /garmin/tokens?user=<email>  → stored session token blob (or null)
 *   PUT  /garmin/tokens?user=<email>  → store/rotate the token blob
 *   POST /garmin/ingest               → { userEmail, days, activities } →
 *                                       import summary
 *
 * The token store lets the stateless Actions runner reuse Garmin's refreshed
 * session across runs — only the very first login (or a revoked refresh
 * token) needs Scott's interactive bootstrap. Garmin credentials themselves
 * never touch this worker; only the client's serialized token JSON does.
 */
import { findOrCreateUser, garminIngestPayload, importGarminData } from "@corpus/core";
import { withAuthDb, withUserDb } from "./db.js";

const TOKENS_KEY_PREFIX = "garmin-tokens:";

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

    const user = await withAuthDb(env, email, (db) =>
      findOrCreateUser(db, email, email.split("@")[0]!, env.DEFAULT_TIMEZONE),
    );
    const ctx = {
      userId: user.id,
      timezone: user.timezone,
      unitPreference: user.unitPreference,
    };
    const summary = await withUserDb(env, user.id, (db) =>
      importGarminData(db, ctx, parsed.data),
    );
    return json(summary);
  }

  return json({ error: "Not found" }, 404);
}
