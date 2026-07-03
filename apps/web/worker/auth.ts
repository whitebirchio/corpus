/**
 * First-party Google sign-in (specs/02-pwa-client/SPEC.md §3): the same
 * upstream verification + email allowlist + findOrCreateUser as the MCP
 * worker's OAuth leg (apps/mcp-server/src/auth/google.ts), but ending in a
 * first-party session cookie instead of an OAuth grant — a first-party app
 * needs no PKCE/DCR dance (SPEC §2 #7).
 */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { findOrCreateUser } from "@corpus/core";
import { withAuthDb } from "./db.js";
import { newSession, SESSION_COOKIE, SESSION_TTL_S, signSession } from "./session.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const STATE_COOKIE = "corpus_oauth_state";

export function allowedEmails(env: Env): string[] {
  return env.ALLOWED_EMAILS.split(",").map((e: string) => e.trim().toLowerCase());
}

export function isSecureRequest(url: string): boolean {
  return new URL(url).protocol === "https:";
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.get("/google", (c) => {
  const secure = isSecureRequest(c.req.url);
  // CSRF protection for the OAuth leg: random nonce, compared on callback.
  // Lax (not Strict) because the callback arrives as a top-level cross-site
  // navigation from Google, which Strict cookies would not accompany.
  const state = crypto.randomUUID();
  setCookie(c, STATE_COOKIE, state, {
    path: "/auth",
    httpOnly: true,
    secure,
    sameSite: "Lax",
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return c.redirect(`${GOOGLE_AUTH_URL}?${params}`, 302);
});

authRoutes.get("/callback", async (c) => {
  const secure = isSecureRequest(c.req.url);
  const code = c.req.query("code");
  const state = c.req.query("state");
  const expectedState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/auth" });
  if (!code || !state || !expectedState || state !== expectedState) {
    return c.text("Invalid OAuth state", 400);
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${new URL(c.req.url).origin}/auth/callback`,
    }),
  });
  if (!tokenRes.ok) {
    return c.text(`Google token exchange failed (${tokenRes.status})`, 502);
  }
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) return c.text("No id_token from Google", 502);

  // The id_token came directly from Google's token endpoint over TLS, so per
  // OIDC it can be decoded without signature verification.
  const payloadPart = tokens.id_token.split(".")[1];
  if (!payloadPart) return c.text("Malformed id_token", 502);
  const claims = JSON.parse(b64urlDecode(payloadPart)) as {
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  const email = claims.email?.toLowerCase();
  if (!email || claims.email_verified !== true) {
    return c.text("Google account email not verified", 403);
  }
  if (!allowedEmails(c.env).includes(email)) {
    return c.text("This Corpus instance is private.", 403);
  }

  const user = await withAuthDb(c.env, email, (db) =>
    findOrCreateUser(db, email, claims.name ?? email.split("@")[0]!, c.env.DEFAULT_TIMEZONE),
  );

  const token = await signSession(newSession(user.id), c.env.SESSION_SECRET);
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "Lax",
    maxAge: SESSION_TTL_S,
  });
  return c.redirect("/", 302);
});

authRoutes.post("/logout", (c) => {
  // Same CSRF stance as API writes (SPEC §2 #15).
  if (c.req.header("x-corpus-csrf") !== "1") {
    return c.json({ error: "Missing X-Corpus-Csrf header" }, 403);
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
