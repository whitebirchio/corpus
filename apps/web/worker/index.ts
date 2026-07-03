/**
 * Corpus PWA worker — REST adapter over @corpus/core plus the static app
 * shell (specs/02-pwa-client/SPEC.md §3). One origin: Workers Static Assets
 * serves the built SPA directly (run_worker_first limits the worker to
 * /api/* and /auth/*), so cookie auth needs no CORS story.
 */
import { Hono } from "hono";
import { ApiError, apiRoutes } from "./api.js";
import { authRoutes } from "./auth.js";

const app = new Hono<{ Bindings: Env }>();

app.route("/auth", authRoutes);
app.route("/api", apiRoutes);

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.message }, err.status);
  console.error("unhandled error", err);
  return c.json({ error: "Internal error" }, 500);
});

// Production never routes other paths here (run_worker_first), but wrangler
// dev and any future catch-alls fall through to the asset host.
app.notFound((c) => {
  const { pathname } = new URL(c.req.url);
  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
