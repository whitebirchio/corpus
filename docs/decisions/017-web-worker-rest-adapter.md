# ADR-017: The `apps/web` worker — a Hono REST adapter plus a Vite/React SPA on one origin

## Status
Accepted

## Date
2026-07-02

## Context
The PWA (ADR-016) needs a server surface. MCP tool semantics are built for LLM tool-calling: several write tools intentionally return *candidates for the agent to confirm* (ADR-008, tier 3) rather than committing. A deterministic UI wants typed endpoints that return structured lists and time series and commit directly.

## Decision
- **A new thin REST adapter over `@corpus/core`**, a sibling of the MCP adapter. The core boundary is unchanged (ADR-004), and data access goes through the same `withUserDb` path, so RLS and canonical units carry over (ADR-006, ADR-007).
- **One new worker, `apps/web`** (deployed as `corpus-app`), separate from `mcp-server`. It serves both the static PWA assets and the `/api/*` + `/auth/*` routes on the **same origin**.
- **Stack:** a Vite + React SPA (`vite-plugin-pwa` for the installable/offline shell), plus **Hono** for the routes, using Workers Static Assets. Vite builds the SPA only; wrangler bundles the worker directly, mirroring `mcp-server`.

## Alternatives Considered

### The PWA as another MCP client
- Rejected: candidate-returning semantics don't suit a UI.

### GraphQL
- Not chosen. No separate rationale recorded.

### Routes added to `mcp-server`
- Rejected: keeps the MCP worker cohesive.

### Separate app and API origins
- Rejected: same origin makes cookie auth trivial, with no CORS split.

### Next.js SSR on Cloudflare (OpenNext)
- Rejected: too many moving parts against a separate API.

### Next.js static export
- Rejected: effectively an SPA anyway.

## Consequences
- **Cost is negligible.** Cloudflare bills per account, with no per-worker base fee. Static asset requests are free; only API invocations bill.
- **Trends charting uses Recharts** (~100 kB gz, cached by the service worker), swappable behind `components/TrendChart.tsx`.
- **Trend buckets:**
  - empty buckets are `null`, not 0, so "not logged" never reads as "ate zero"
  - weeks start Monday (ISO)
  - `calories_out` ships `active` and `bmr` as separate series
- **Testing:** a small vitest suite lives in `apps/web` for adapter-owned security logic (session signing). This is a deliberate exception to "all tests in core".
- **No CSP/security headers on the static HTML in v1.** Revisit as writes land.

---
Backfilled 2026-10-25 from specs/02-pwa-client/SPEC.md §2 #3–5, #9, #12–14 and FOLLOWUPS.md judgement calls #1–5, #9–10, #12 @ specs-archive.
