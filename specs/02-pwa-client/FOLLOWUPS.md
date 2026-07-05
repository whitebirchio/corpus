# PWA client — follow-ups for Scott

Written during the autonomous implementation session (2026-07-03). Two lists: **action items**
you need to take outside this repo before the PWA works end-to-end, and **judgement calls** I
made without you that you may want to review (each is cheap to change if you disagree).

## Action items (outside-repo, blocking end-to-end use)

**Status: all 4 confirmed complete (2026-07-05).**

1. **Google OAuth redirect URIs.** On the existing Google OAuth client (Cloud Console →
   Credentials → your client → Authorized redirect URIs) add:
   - `https://corpus-app.whitebirch.workers.dev/auth/callback` (production — adjust if the
     worker lands on a different hostname; the code derives the redirect URI from the request
     origin, so no repo change needed either way)
   - `http://localhost:8788/auth/callback` (local `wrangler dev` for apps/web)

2. **Worker secrets for `corpus-app`.** From `apps/web/`, once:
   ```sh
   npx wrangler secret put DATABASE_URL          # same Neon prod string the MCP worker uses
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET        # generate: openssl rand -base64 32
   ```
   Until these exist, deploys succeed but `/auth/*` and `/api/*` return 500s.
   Rotating `SESSION_SECRET` invalidates every session (the only remote-logout lever in v1).

3. **First deploy.** Merging to `main` auto-deploys via CI (deploy.yml now builds + deploys
   `apps/web` too), or manually: `npm run build -w corpus-web && npm run deploy -w corpus-web`.
   The first deploy creates the `corpus-app` worker; note the actual `workers.dev` hostname and
   circle back to item 1 if it differs.

4. **Local dev vars** (only when you want Layer-3 dev for the web app): create
   `apps/web/.dev.vars` (gitignored) with `DATABASE_URL` (Neon **dev branch**),
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` (any random string locally).

5. **Install on your phone.** After deploy + secrets: open the app URL in Safari → Share →
   "Add to Home Screen". Installed-PWA storage is the durable kind the spec's session decision
   leans on.

## Judgement calls to review

Full rationale for each is in [IMPLEMENTATION.md](./IMPLEMENTATION.md); this is the short list
of "you might have chosen differently":

1. **Chart library: Recharts** (spec open question). Chosen for React DX; ~100 kB gz, cached by
   the service worker after first load. Swappable behind `components/TrendChart.tsx` (uPlot is
   the lightweight alternative).
2. **Trends default: last 30 days, day buckets** (spec open question), presets 7D/30D/90D/1Y.
3. **Empty buckets are `null`, not 0 — including additive metrics.** A day with no logged meals
   reads as "not logged" rather than "ate zero kcal". Charts show gaps. If you'd rather
   zero-fill intake/mileage, it's a one-line change in `packages/core/src/repos/trends.ts`.
4. **Weeks start Monday (ISO)** for week buckets; bucket label = start date.
5. **`calories_out` ships `active` and `bmr` as separate series** (UI stacks them for total)
   instead of a pre-summed total, so days missing BMR don't understate silently.
6. **Session: 90-day rolling** (top of the spec's 60–90 range), cookie holds only the user id;
   the user row (timezone/units) and the email allowlist are re-checked on every request, so
   allowlist removal takes effect immediately, not at next login.
7. **CSRF: `SameSite=Lax` + required `X-Corpus-Csrf: 1` header on non-GETs** (spec offered
   Strict+header or double-submit; Lax+header keeps external links into the app working).
8. **Worker/package naming:** worker `corpus-app`, npm workspace `corpus-web`, dev port
   **:8788** (mcp-server keeps :8787).
9. **No Cloudflare Vite plugin:** Vite builds the SPA only; wrangler bundles the worker
   directly (mirrors mcp-server). Dev = `wrangler dev` (+ optional Vite HMR proxy on :5173).
10. **A small vitest suite lives in `apps/web`** (session-cookie signing) — deviation from
    "all tests in core" because it's adapter-owned security logic; root `npm test` still
    catches it.
11. **Icons are programmatically generated** (`scripts/gen-icons.mjs`, committed PNGs) — a
    minimal "C" mark so the home-screen install looks intentional. Replace at will.
12. **No CSP/security headers on the static HTML in v1** — Workers Static Assets serves the
    shell without a worker hop; revisit if/when writes land (noted in IMPLEMENTATION §6).
13. **The Today view got a small prev/next day stepper** (not in the spec's two use cases) —
    it reuses the same `/api/days/:date/*` resources, so "how did yesterday end up" costs ~20
    lines of UI. Remove if you want the view strictly today-only.
