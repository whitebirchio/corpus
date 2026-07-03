# PWA client — implementation design

Companion to [SPEC.md](./SPEC.md), written at implementation start (2026-07-03). SPEC.md locked
the architecture decisions; this document records how the read-only v1 is actually built —
concrete shapes, routes, session mechanics, and project layout — plus the judgement calls made
where the spec left room. Anything requiring action outside this repo is in
[FOLLOWUPS.md](./FOLLOWUPS.md).

## 1. Workspace layout

One new workspace, `apps/web` (npm package `corpus-web`, Cloudflare worker `corpus-app`),
sibling to `apps/mcp-server`, per SPEC §2 #12/#14:

```
apps/web/
  wrangler.jsonc          # worker config: main = worker/index.ts, static assets = dist/client
  package.json            # corpus-web
  tsconfig.json           # solution file → app + worker + node configs
  tsconfig.app.json       # src/ (DOM, react-jsx, vite types)
  tsconfig.worker.json    # worker/ (workerd types via generated worker-configuration.d.ts)
  vite.config.ts          # React SPA + vite-plugin-pwa; dev proxy /api,/auth → wrangler dev
  index.html
  public/                 # generated PWA icons (committed), favicon
  scripts/gen-icons.mjs   # regenerates the icons (zero-dependency PNG writer)
  worker/                 # the REST adapter (Hono on Workers)
    index.ts              #   Hono app wiring: /auth/*, /api/*, 404 fallthrough
    env.d.ts              #   hand-maintained Env additions (secrets)
    db.ts                 #   withUserDb / withAuthDb (same pattern as mcp-server)
    session.ts            #   signed rolling session cookie (pure functions, unit-tested)
    auth.ts               #   /auth/google, /auth/callback, /auth/logout
    api.ts                #   /api/me, /api/days/:date/*, /api/meals/:id, /api/trends/:metric
  test/session.test.ts    # vitest for the cookie sign/verify/expiry logic
  src/                    # the React SPA
    main.tsx, App.tsx, api.ts, format.ts, styles.css
    views/Today.tsx, views/Trends.tsx, views/Login.tsx
    components/...        # macro bars, chart wrapper, pickers
```

The worker stays a thin `validate → withUserDb → call core repo → serialize` shell; all new
domain logic (range/time-series queries) lives in `packages/core` with PGlite tests, exactly
like the MCP adapter (SPEC §2 #5).

**Build/dev model (judgement call).** Vite builds only the SPA (`dist/client`); wrangler
bundles the worker TypeScript itself, same as `mcp-server`. No Cloudflare Vite plugin — fewer
moving parts, and deploy stays plain `wrangler deploy`. Dev is two processes:
`npm run dev -w corpus-web` (build assets once, then `wrangler dev` on **:8788** — full stack
including auth against a Neon dev branch) and optionally `npm run dev:ui -w corpus-web`
(Vite dev server on :5173 with HMR, proxying `/api` + `/auth` to :8788).

## 2. Core additions (`packages/core`)

### 2.1 Trend repo — `src/repos/trends.ts`

The one real domain addition (SPEC §4). Single entry point:

```ts
type TrendMetric = "calories_in" | "body_battery" | "resting_hr" | "distance_run" | "calories_out";
type TrendBucket = "day" | "week" | "month";

getTrend(db, ctx, { metric, from, to, bucket }): Promise<TrendResult>

interface TrendResult {
  metric: TrendMetric;
  bucket: TrendBucket;
  from: string;                    // YYYY-MM-DD, inclusive
  to: string;                      // YYYY-MM-DD, inclusive
  series: TrendSeries[];
}
interface TrendSeries {
  key: string;                     // e.g. "calories", "high", "low", "active", "bmr"
  agg: "sum" | "avg";              // how days combine into week/month buckets
  unit: string;                    // canonical: "kcal" | "bpm" | "m" | "score"
  points: TrendPoint[];            // dense — one per bucket in range, aligned across series
}
interface TrendPoint {
  bucket: string;                  // YYYY-MM-DD bucket start (day itself / ISO Monday / 1st)
  value: number | null;            // null = no underlying data in the bucket
  daysWithData: number;            // distinct local_dates contributing
}
```

Per-metric sources and aggregation (per SPEC §4's table — agg is **per-metric, not uniform**):

| metric | source | series (agg) |
|---|---|---|
| `calories_in` | `meals.calories` summed per `local_date` | `calories` (sum) |
| `body_battery` | `daily_metrics.body_battery`, `.body_battery_low` | `high` (avg), `low` (avg) |
| `resting_hr` | `daily_metrics.resting_hr` | `resting_hr` (avg) |
| `distance_run` | `workout_blocks.distance_m` on `block_type = 'run'`, joined to sessions for `local_date` | `distance` (sum, meters) |
| `calories_out` | `daily_metrics.active_kcal`, `.bmr_kcal` | `active` (sum), `bmr` (sum) |

Judgement calls baked in:

- **Bucket boundaries:** `date_trunc` on `local_date` — weeks are **ISO weeks (Monday start)**,
  months are calendar months. Buckets are labeled by their start date; the first/last buckets
  of a range may be partial (they aggregate only in-range days).
- **Dense series, `null` for empty buckets** — for *all* metrics, including additive ones. A
  day with no logged meals is "not logged", not "ate zero"; charts skip nulls. `daysWithData`
  rides along so a client can render weekly/monthly *daily averages* for additive metrics
  (`value / daysWithData`) without a second endpoint — this is the "bucket sum / daily-average"
  duality the SPEC table calls out.
- **`calories_out` returns `active` and `bmr` as separate sum series** rather than a
  pre-summed total: the client stacks them (total) or shows active alone, and a day with
  active-but-no-BMR data stays honest instead of masquerading as a total.
- Everything returns **canonical units** (meters, kcal); display conversion is the adapter's
  job (SPEC §3).
- Range is validated `from <= to`, both `YYYY-MM-DD`, capped at 3660 days (~10 years) to bound
  response size; day-bucket multi-year queries are allowed per SPEC §4.

Implementation is one grouped query per series source (SQL `GROUP BY date_trunc`), then a JS
dense-fill pass over the generated bucket starts. PGlite tests cover: bucketing across
week/month boundaries, per-metric agg correctness, gap handling, partial buckets, run-block
filtering (non-run blocks excluded), and multi-user isolation.

### 2.2 Meal detail — `src/repos/meals.ts`

`getMealWithItems(db, ctx, mealId)` → `{ meal, items } | undefined`, backing
`GET /api/meals/:id` (write-forward guardrail: records stay addressable, SPEC §5.1/5.2).
`getDayNutrition` already returns full meal rows (id, source, granularity) and is reused as-is.

### 2.3 Query schema — `src/schemas/trends.ts`

Zod shapes (`trendQuerySchema`) exported from core so the adapter validates identically to
tests, matching the existing `schemas/inputs.ts` pattern.

## 3. REST adapter (`apps/web/worker`)

### 3.1 Routes

```
GET  /auth/google            → 302 to Google (state nonce cookie set)
GET  /auth/callback          → verify → allowlist → findOrCreateUser → set session cookie → 302 /
POST /auth/logout            → clear cookie (requires CSRF header)

GET  /api/me                 → { user: { email, displayName, timezone, unitPreference }, today }
GET  /api/days/:date/nutrition → { date, meals: [...], totals, targets }   (getDayNutrition)
GET  /api/days/:date/metrics   → { date, metrics: DailyMetrics | null }    (getDailyMetrics)
GET  /api/meals/:id            → { meal, items }                           (getMealWithItems)
GET  /api/trends/:metric?from&to&bucket → TrendResult (distance converted for display)
```

Resource-shaped GETs so `PATCH/DELETE /api/meals/:id` slot in later without restructuring
(SPEC §5.2). Errors are JSON `{ error }` with 400/401/403/404/500. Everything under `/api`
requires a valid session; failures return 401 (the SPA shows the login view — no redirects on
API routes).

**Unit conversion at the edge:** `distance_run` values are converted meters → miles (imperial
pref) or km (metric pref) in the adapter, `unit` tagged accordingly. kcal/bpm/score pass
through. Core never converts (SPEC §3).

**Freshness over cookie payload (judgement call):** the session cookie carries only
`{ uid, iat, exp }`. Each `/api` request opens the usual `withUserDb` transaction and loads the
user row (RLS `users_self` policy admits it) to build `UserCtx` — timezone/unit changes made
conversationally take effect immediately, and the allowlist is re-checked per request so
removing an email actually locks the account out (not just at next login).

### 3.2 Session mechanics (SPEC §2 #8/#15)

- Cookie `corpus_session`: `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`, keyed by
  the `SESSION_SECRET` worker secret (WebCrypto). Stateless — no session table, no KV.
- **90-day rolling expiry** (top of the spec's 60–90 target): every authenticated `/api`
  response re-issues the cookie with a fresh `exp`. httpOnly, `SameSite=Lax`, `Path=/`,
  `Max-Age` 90d; `Secure` when the request origin is https (so `wrangler dev` over
  http://localhost still works).
- **CSRF stance (decided now, per SPEC §5.3):** `SameSite=Lax` **+ custom header
  `X-Corpus-Csrf: 1` required on every non-GET** under `/api` and on `/auth/logout`. v1's only
  non-GET is logout; future writes inherit the rule. The SPA's fetch wrapper always sends it.
- OAuth state: random nonce carried in a 10-minute httpOnly cookie and compared to the `state`
  param on callback. The Google leg mirrors `mcp-server/src/auth/google.ts` (code flow,
  id_token decoded from the direct TLS token-endpoint response, `email_verified` required,
  allowlist gate) — same Google client, new redirect URI on this worker's origin.

### 3.3 Worker config

Workers Static Assets serves `dist/client` with `not_found_handling:
"single-page-application"`; `run_worker_first: ["/api/*", "/auth/*"]` keeps every other request
(the app shell, JS, icons) on the free asset path with zero DB exposure. Vars: `ALLOWED_EMAILS`,
`DEFAULT_TIMEZONE`. Secrets: `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`SESSION_SECRET` (see FOLLOWUPS).

## 4. PWA frontend (`apps/web/src`)

- **Stack:** React 18 + Vite; no router dependency — two tabs (Today / Trends) on hash state so
  install-relaunch restores the last view. Mobile-first single-column layout, dark-mode aware.
- **Charts (spec open question → decided):** **Recharts**. Reasoning: first-class React
  composition, good touch/tooltip behavior out of the box, and every v1 chart (bars for
  additive metrics, lines for averages, stacked bars for calories-out) is a one-liner variant.
  Bundle cost (~100 kB gz) is a one-time hit the service worker then caches; uPlot was the
  size-optimal alternative if this ever matters. Charts render behind a small local wrapper
  (`components/TrendChart.tsx`) so the library is swappable.
- **Default view (spec open question → decided):** app opens on **Today**; Trends defaults to
  **last 30 days, day buckets**, with presets 7D / 30D / 90D / 1Y and a manual day/week/month
  bucket override (auto-bucket: 7D/30D→day, 90D→week, 1Y→week).
- **Today view:** calories vs target (large number + progress bar), protein/carbs/fat bars,
  addressable meal list (time, description, kcal, P/C/F — ids in the DOM for the future edit
  phase), and a metrics strip (Body Battery high/low, resting HR, steps, active kcal) when a
  `daily_metrics` row exists.
- **PWA shell:** `vite-plugin-pwa` (`registerType: "autoUpdate"`) — manifest (standalone,
  portrait, theme-colored, generated 192/512/maskable/apple-touch icons committed under
  `public/`), precached app shell, and **NetworkFirst runtime caching for `/api/` GETs**
  (3s network timeout, 1-day expiry) so a cold offline open still shows the last-seen dashboard
  (SPEC §4's "offline-tolerant", deliberately not offline-capable).
- Session gate: `GET /api/me` on load — 401 renders the Login view (a "Continue with Google"
  link to `/auth/google`).

## 5. Testing & CI

- Core trends/meal-detail: PGlite tests in `packages/core/test/trends.test.ts` (+ a meal-detail
  case in `meals.test.ts`), same harness as everything else.
- `apps/web/test/session.test.ts`: vitest over the pure session-cookie functions
  (sign/verify/tamper/expiry/rolling refresh). This is the one deliberate deviation from
  "all tests live in core": session signing is adapter-owned security logic with no core
  equivalent, and it runs under plain Node (WebCrypto is global). Root `npm test` picks it up
  via `--workspaces --if-present`.
- Frontend: no component tests in v1 (presentation-only over typed API responses); typecheck
  covers the SPA.
- CI: `deploy.yml` gains a `vite build` + `wrangler deploy` step for `apps/web` after the
  existing mcp-server deploy (same `CLOUDFLARE_API_TOKEN`). First real deploy needs the
  secrets set — until then the worker deploys but auth 500s (documented in FOLLOWUPS).

## 6. Explicitly deferred (unchanged from SPEC)

Writes (`PATCH/DELETE /api/meals/:id`), revocable server-side sessions/remote logout, imported-
record edits, native app, push/widgets. Also noted for later: CSP/security headers on the
static HTML (Workers Static Assets serves it without a worker hop; adding headers means either
`run_worker_first: true` or a `_headers` mechanism), and extracting the duplicated
`withUserDb`/`withAuthDb` (~50 lines) into a tiny shared package if a third adapter ever
appears.
