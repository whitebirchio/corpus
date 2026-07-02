/**
 * Hand-maintained Env additions for secrets that `wrangler types` can't see
 * (it only knows vars in wrangler.jsonc and keys present in .dev.vars).
 * Global interface merge with the generated worker-configuration.d.ts.
 */
interface Env {
  /** Shared secret for the Garmin sync endpoints (/garmin/*). Set with
   * `npx wrangler secret put GARMIN_INGEST_SECRET`; optional so the routes
   * can 503 cleanly on deployments that haven't configured the sync. */
  GARMIN_INGEST_SECRET?: string;
}
