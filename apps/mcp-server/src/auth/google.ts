/**
 * Default (non-API) handler for the OAuthProvider: implements the /authorize
 * and /callback leg using Google as the upstream identity provider, with a
 * hard email allowlist (SPEC.md §7).
 *
 * Flow: Claude → /authorize (we parse the OAuth request, stash it in `state`,
 * bounce to Google) → Google login → /callback (verify email against the
 * allowlist, find-or-create the user row, completeAuthorization → grant
 * carries GrantProps to the MCP agent).
 */
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { findOrCreateUser } from "@corpus/core";
import { withAuthDb } from "../db.js";
import type { GrantProps } from "../types.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

function allowedEmails(env: Env): string[] {
  return env.ALLOWED_EMAILS.split(",").map((e: string) => e.trim().toLowerCase());
}

async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauthReq: AuthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const redirectUri = `${new URL(request.url).origin}/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    // The downstream OAuth request rides through Google's state param.
    state: b64urlEncode(JSON.stringify(oauthReq)),
    prompt: "select_account",
  });
  return Response.redirect(`${GOOGLE_AUTH_URL}?${params}`, 302);
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return new Response("Missing code or state", { status: 400 });

  let oauthReq: AuthRequest;
  try {
    oauthReq = JSON.parse(b64urlDecode(state)) as AuthRequest;
  } catch {
    return new Response("Invalid state", { status: 400 });
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${url.origin}/callback`,
    }),
  });
  if (!tokenRes.ok) {
    return new Response(`Google token exchange failed (${tokenRes.status})`, { status: 502 });
  }
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) return new Response("No id_token from Google", { status: 502 });

  // The id_token came directly from Google's token endpoint over TLS, so per
  // OIDC it can be decoded without signature verification.
  const payloadPart = tokens.id_token.split(".")[1];
  if (!payloadPart) return new Response("Malformed id_token", { status: 502 });
  const claims = JSON.parse(b64urlDecode(payloadPart)) as {
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  const email = claims.email?.toLowerCase();
  if (!email || claims.email_verified !== true) {
    return new Response("Google account email not verified", { status: 403 });
  }
  if (!allowedEmails(env).includes(email)) {
    // Allowlist is the actual gate — DCR being open admits no one extra.
    return new Response("This Corpus instance is private.", { status: 403 });
  }

  const user = await withAuthDb(env, email, (db) =>
    findOrCreateUser(db, email, claims.name ?? email.split("@")[0]!, env.DEFAULT_TIMEZONE),
  );

  const props: GrantProps = {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    timezone: user.timezone,
    unitPreference: user.unitPreference,
  };

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: user.id,
    metadata: { email },
    scope: oauthReq.scope ?? [],
    props,
  });
  return Response.redirect(redirectTo, 302);
}

export const GoogleHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/authorize") return handleAuthorize(request, env);
    if (pathname === "/callback") return handleCallback(request, env);
    if (pathname === "/") {
      return new Response("Corpus MCP server. Connect via an MCP client at /mcp.", {
        status: 200,
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
