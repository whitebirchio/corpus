# PWA client — epic spec

**Status:** Design complete — all decisions locked, read-only v1 scoped and ready to build. Started 2026-07-02.
**Owner:** Scott Schmalz

## 1. Motivating context

Corpus is MCP-only today: all data entry and analysis happens conversationally through Claude, per [specs/01-initial-platform/SPEC.md](../01-initial-platform/SPEC.md) principle 3 ("agent-first interaction, no UI in v1"). This epic adds a **progressive web app (PWA)** as a second, *complementary* interface onto the same system and data — for the cases where a glanceable UI or a direct visual edit beats a chat turn (checking today's macros on your phone, scanning trends, later fixing a bad value or deleting a duplicate).

It is explicitly not a replacement for the conversational surface. Every operation the PWA supports is expected to remain available conversationally too; there is no PWA-only capability planned. The PWA is the convenient, glanceable, mobile-first way *in* — optimized so Scott can pop it open throughout the day without re-authenticating.

This absorbs the **"read-only dashboard"** backlog item from [specs/README.md](../README.md) — that is now this epic's v1.

## 2. Decision log

| # | Decision | Choice | Alternatives considered |
|---|----------|--------|------------------------|
| 1 | Client form factor | **PWA** — responsive web app, installable to the iOS home screen | Native Swift/SwiftUI app, plain responsive web (no install), both |
| 2 | Why not native (yet) | Native costs a separate Swift codebase (no reuse of the TS stack), Xcode, the $99/yr Apple Developer Program, and signing/TestFlight just to run a single-user app — for ~10% more polish. Revisit only on a concrete trigger (below). | Native-first |
| 3 | Server surface for the client | **New thin HTTP/REST adapter over `@corpus/core`**, sibling to the MCP adapter | Client acts as another MCP client; GraphQL |
| 4 | Why not reuse `/mcp` | MCP tool semantics are built for LLM tool-calling, not a deterministic UI — several write tools intentionally return *candidates for the agent to confirm* (soft-match dedup) rather than committing. A UI wants typed endpoints returning structured lists/time-series that commit directly. | Reuse MCP surface |
| 5 | Core boundary | Unchanged. The REST adapter is just another spoke on the hexagon; `@corpus/core` keeps its no-HTTP/no-MCP boundary (epic 1 principle 7). All logic + tests stay in core; the adapter stays a thin `validate → call repo → echo` shell. | New HTTP deps in core |
| 6 | Identity | **Reuse** the existing Google upstream verification + email allowlist + `findOrCreateUser` | New identity provider |
| 7 | Session model | **First-party httpOnly session cookie**, not the OAuth 2.1 / Dynamic Client Registration flow. DCR exists because *Claude* is a third-party OAuth client that must self-register; a first-party app Scott owns does not need that dance. | Make the PWA an OAuth client like Claude |
| 8 | "Don't keep logging in" | Long **rolling session** (target 60–90 days, silently refreshed on each visit). This is a session-lifetime decision, independent of PWA-vs-native. httpOnly cookies also survive iOS Safari storage eviction better than script-writable storage; installed (home-screen) PWAs get more durable storage than in-browser tabs. | Short sessions + frequent re-login |
| 9 | Data access control | **Unchanged** — the REST adapter goes through the same `withUserDb(env, userId, fn)` path, so Postgres RLS and the canonical-unit invariants (kg/m/s/kcal) carry over as-is. | New access path |
| 10 | v1 scope | **Read-only** (today's macros vs. target; trend visualizations). Writes are a deliberate later phase, but the read v1 is built write-forward (see §5). | Read+write from day one; read-only forever |
| 11 | Imported-record edits | **Out of scope, and not a concern in practice.** Editing/deleting Garmin- or import-sourced records collides with the idempotent importers (re-import overwrites edits, re-sync resurrects deletes). Scott has no use case for editing biometric/exercise data from Garmin, and is deprecating MacroFactor in favor of conversational `log_meal`. PWA writes target user-authored / AI-estimated (`source = "conversation"`) records only. | Tombstone/override layer in core (deferred until a real need appears) |
| 12 | Worker topology | **One new `apps/web` worker**, separate from `mcp-server`, serving **both** the static PWA assets and the `/api/*` + `/auth/*` routes (same origin). Keeps the MCP worker cohesive; same origin makes cookie auth trivial (no CORS split between app and API). | Add routes to `mcp-server`; split app-host and API into two origins |
| 13 | Worker cost | **Negligible.** Cloudflare bills per account, not per worker — the Workers Paid ($5/mo) 10M-request / 30M-CPU-ms pool is shared across all workers, no per-worker base fee. Workers Static Assets serves the built bundle free (asset requests don't count); only API invocations bill. | — |
| 14 | Frontend stack | **Vite + React SPA** (with `vite-plugin-pwa` for the installable/offline shell) + **Hono** for the `/api` routes, all in the one `apps/web` worker via Workers Static Assets. Least machinery, cheapest, same-origin. | Next.js SSR on Cloudflare (OpenNext adapter — too much moving-part cost against a separate API); Next.js static export (Next DX but effectively an SPA anyway) |
| 15 | Session mechanics | **Rolling** (sliding-window) expiry via a **signed stateless cookie**, re-issued each request — no DB lookup. CSRF: **`SameSite=Lax` + a custom header required on writes**. A revocable server-side session table is deferred until remote logout is actually wanted; CSRF only bites the write phase, so v1's read-only GETs are safe regardless. | Fixed-expiry session; server-side session row from day one; double-submit CSRF token |

## 3. Architecture

**Another adapter over the same core.** The system stays hexagonal:

```
                    ┌───────────────────────┐
   Claude ── MCP ──▶│ apps/mcp-server        │──┐
                    └───────────────────────┘  │
                                                ├──▶ @corpus/core ──▶ Neon (RLS)
   PWA ── REST ────▶┌───────────────────────┐  │       repos / schemas / units
                    │ HTTP/REST adapter      │──┘
                    └───────────────────────┘
```

- The REST adapter calls the same `packages/core` repos through `withUserDb`, so every statement is RLS-scoped to the user exactly as the MCP path is. No new security surface — same allowlist, same `app.user_id`, same row-level policies.
- The REST adapter lives in a **separate `apps/web` worker** (§2 #12), not in `mcp-server` — keeping the MCP worker's `OAuthProvider` routing clean. That same worker also serves the static PWA bundle via Workers Static Assets, so app and API share an origin.
- Canonical storage is untouched: the adapter serves canonical units and converts at the edge for display, mirroring how tools accept unit-tagged input. The "convert at the adapter edge, never in core" discipline holds.

**Session/auth.** Google sign-in on the PWA's own domain → verify email against the allowlist and `findOrCreateUser` (reusing the epic 1 identity primitives) → set a first-party httpOnly, `Secure`, `SameSite` session cookie with a long rolling lifetime. No PKCE/DCR. CSRF stance is decided up front (§5) even though read-only GETs don't require it, so adding writes later isn't an auth refactor.

## 4. v1 scope — read-only

Two use cases:

1. **Today's macros vs. target.** Nearly free: `getDayNutrition` already returns `{ meals, totals, targets }`. Primarily a presentation layer.
2. **Trend visualizations over time.** This is the real build. Existing repos are day-scoped (`getDailyMetrics`, `getDayNutrition` take a single date); v1 adds **range / time-series repo methods** in core, each PGlite-tested, plus the REST endpoints and the PWA chart UI over them. The v1 metrics and their backing columns:

   | Metric | Source | Bucket aggregation |
   |---|---|---|
   | Caloric intake | sum of `meals.calories` per day | additive (bucket sum / daily-average) |
   | Body Battery | `daily_metrics.body_battery` (day high), `body_battery_low` | average |
   | Resting HR | `daily_metrics.resting_hr` | average |
   | Miles ran | `workout_blocks.distance_m` on run-type blocks | additive (bucket sum) |
   | Calories burned | `daily_metrics.active_kcal` (+ `bmr_kcal` for total) | additive (bucket sum / daily-average) |

   **Granularity:** day / week / month buckets. **Range:** a single day up to multiple years. Storage is daily-grain; week/month are computed on read. Note the aggregation rule is **per-metric, not uniform** — intake/miles/burn are additive (sum within a bucket), while Body Battery and RHR are averages — so the range methods carry a per-metric agg, not one-size-fits-all.

Honest effort picture: the "today" view is close to a freebie; the work is (a) range/time-series repo methods in core, (b) the REST adapter + first-party session, (c) the PWA shell (installable, offline-tolerant) and charts.

## 5. Write-forward guardrails (build these into the read-only v1)

The schema already makes future edit/delete clean — daily macro totals are **derived** (`getDayNutrition` sums the day's `meals` rows live; there is no materialized rollup to keep in sync), `meals` carry a stable `id` + `source` + `estimateConfidence`, and `meal_items` cascade-delete with their meal. To keep that path open, the read-only v1 must:

1. **Expose IDs and provenance in read payloads, not just aggregates.** Return the addressable meal list with `id`, `source`, `granularity`, `estimateConfidence` — not summary-only blobs. The dashboard shows totals; the data underneath stays addressable.
2. **Shape routes as REST resources, GET-only for now** (`/…/days/:date/nutrition`, `/…/meals/:id`, `/…/trends/*`) so `PATCH`/`DELETE /…/meals/:id` slot in without restructuring.
3. **Decide the CSRF stance now** (SameSite=Strict + custom header, or double-submit token) and set the session cookie accordingly, even though GETs don't need it.
4. **Keep writes in core when they land** — `updateMeal` / `deleteMeal` in `packages/core/src/repos/meals.ts` with tests; the adapter stays a thin shell. (Nothing to build now; just don't violate it.)

### Anticipated first writes (a later phase, not v1)

- **Edit** AI-estimated macro/nutrition values that came out coarser than wanted.
- **Delete** a duplicate meal (the concrete case that motivated this: a meal logged twice).

Both target `source = "conversation"` records, which no importer touches — so no overwrite/resurrection collision (§2 #11).

## 6. Non-goals / deferred

- **Native iOS app.** Deferred, not rejected. Revisit on a concrete trigger the PWA can't satisfy: home-screen/lock-screen **widgets** (glanceable status without opening anything), **Siri/Shortcuts** voice logging, or reliable **background refresh + push**. The REST API built here serves a native client equally well, so starting with the PWA doesn't block it.
- **Editing/deleting imported or synced records** (Garmin, any importer). Needs a tombstone/override concept in core; out of scope until a real use case appears (§2 #11).
- **PWA-only capabilities.** None planned; the PWA stays at parity-or-subset of the conversational surface.

## 7. Open questions

Deferred to implementation start — none block the design:

- Default range/granularity the v1 dashboard opens on (e.g. last 30 days, daily buckets).
- Chart library.
