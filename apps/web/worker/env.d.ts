/**
 * Hand-maintained Env additions for secrets that `wrangler types` can't see
 * (it only knows vars in wrangler.jsonc and keys present in .dev.vars).
 * Global interface merge with the generated worker-configuration.d.ts.
 */
interface Env {
  /** Neon connection string — same database (and RLS policies) as the MCP worker. */
  DATABASE_URL: string;
  /** The existing Google OAuth client, reused for first-party sign-in. */
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** HMAC-SHA256 key for the stateless session cookie. Rotate to revoke all sessions. */
  SESSION_SECRET: string;
  /**
   * Optional api.data.gov key for USDA FDC barcode fallback (specs/05 §5).
   * Without it, unknown-to-OFF barcodes just come back not_found.
   */
  FDC_API_KEY?: string;
}
