import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/**
 * Secrets (wrangler secret put) and injected helpers aren't in wrangler.jsonc,
 * so they don't appear in the generated worker-configuration.d.ts — merge them
 * into the global Env here.
 */
declare global {
  interface Env {
    DATABASE_URL: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    /** Injected by OAuthProvider into the default (auth UI) handler only. */
    OAUTH_PROVIDER: OAuthHelpers;
  }
}

/** Per-grant props set at authorization time; McpAgent receives them as this.props. */
export interface GrantProps extends Record<string, unknown> {
  userId: string;
  email: string;
  displayName: string;
  timezone: string;
  unitPreference: "imperial" | "metric";
}
