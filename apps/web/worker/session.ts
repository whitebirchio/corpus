/**
 * First-party session for the PWA (specs/02-pwa-client/SPEC.md §2 #7/#8/#15):
 * a signed *stateless* cookie — no session table, no KV. Payload carries only
 * the user id; timezone/units and the email allowlist are re-checked against
 * the DB on every request, so nothing here can go stale and allowlist removal
 * takes effect immediately.
 *
 * Token format: `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`.
 * Rolling expiry: every authenticated /api response re-issues the cookie with
 * a fresh 90-day window. Rotating SESSION_SECRET invalidates every session.
 *
 * Pure WebCrypto functions (no framework imports) so they run identically in
 * workerd and under vitest on Node.
 */

export const SESSION_COOKIE = "corpus_session";
export const SESSION_TTL_S = 90 * 24 * 3600; // rolling 90 days (spec targets 60-90)

const VERSION = "v1";
const enc = new TextEncoder();

export interface SessionPayload {
  /** users.id */
  uid: string;
  /** issued-at, unix seconds */
  iat: number;
  /** expiry, unix seconds */
  exp: number;
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function newSession(uid: string, now: number = Date.now()): SessionPayload {
  const iat = Math.floor(now / 1000);
  return { uid, iat, exp: iat + SESSION_TTL_S };
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${VERSION}.${body}`));
  return `${VERSION}.${body}.${b64url(mac)}`;
}

/** Null on any defect: bad shape, bad signature, malformed payload, expired. */
export async function verifySession(
  token: string,
  secret: string,
  now: number = Date.now(),
): Promise<SessionPayload | null> {
  const [version, body, macPart, ...rest] = token.split(".");
  if (version !== VERSION || !body || !macPart || rest.length > 0) return null;

  const mac = b64urlDecode(macPart);
  if (!mac) return null;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    mac,
    enc.encode(`${VERSION}.${body}`),
  );
  if (!ok) return null;

  const payloadBytes = b64urlDecode(body);
  if (!payloadBytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  const p = parsed as Partial<SessionPayload>;
  if (typeof p.uid !== "string" || typeof p.iat !== "number" || typeof p.exp !== "number") {
    return null;
  }
  if (p.exp * 1000 <= now) return null;
  return { uid: p.uid, iat: p.iat, exp: p.exp };
}

/**
 * Set-Cookie value for the session. httpOnly + SameSite=Lax; CSRF protection
 * for writes comes from the required X-Corpus-Csrf header (SPEC §2 #15).
 * `secure` is derived from the request protocol so wrangler dev over
 * http://localhost still works.
 */
export function sessionCookie(token: string, secure: boolean): string {
  return (
    `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_TTL_S}; Path=/; HttpOnly; SameSite=Lax` +
    (secure ? "; Secure" : "")
  );
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax` + (secure ? "; Secure" : "");
}
