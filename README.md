# Corpus

Personal health & wellness tracking, built AI-agent-first: all data entry and
analysis happens conversationally through a remote MCP server connected to
Claude. Tracks workouts (strength / running / metcons), nutrition,
medications & supplements, labs and fitness tests, wearable biometrics, and
goals — one schema, one timeline, one place to ask *"what should I do today?"*

## Architecture

- **[specs/](specs/README.md)** — the design history, one subdirectory per
  epic of work (data model, MCP surface, auth, idempotency all live in the
  first epic's spec). Read this first.
- **`packages/core`** — domain core: Drizzle schema, Zod tool schemas, unit
  conversion (canonical metric storage), timezone handling, repositories with
  dedup/upsert semantics. No MCP or HTTP dependencies.
- **`apps/mcp-server`** — Cloudflare Worker: OAuth 2.1 (Google upstream, email
  allowlist) via `workers-oauth-provider`, MCP over Streamable HTTP via the
  Agents SDK (`McpAgent`), RLS-scoped Neon Postgres access.

Runs at ~$0/month on Cloudflare + Neon free tiers.

## Getting started

See **[docs/SETUP.md](docs/SETUP.md)** for one-time account setup
(Neon, Google OAuth, Cloudflare, Claude connector), and
**[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** for the local dev workflow.

```sh
npm install
npm test               # core tests against in-memory Postgres (PGlite)
npm run typecheck
npm run dev            # local worker on :8787
npm run deploy         # deploy to Cloudflare
```

## Status

The initial platform ([specs/01-initial-platform](specs/01-initial-platform/SPEC.md))
is implemented through Phase 3, minus one leftover item:

- **Phase 1 — core daily loop:** check-ins, workouts, meals, regimen, goals,
  insights, daily summary, read-only SQL analysis.
- **Phase 2 — baselines & documents:** `record_lab_panel` (with a ~90-analyte
  canonical dictionary and censored/qualitative value handling),
  `record_fitness_test` (VO2 max / RMR / DEXA, with DEXA fan-out to body
  composition + regional detail), `get_lab_history`, and optional original-file
  storage in R2 via a credential-free worker upload route.
- **Phase 3 — imports & rhythm:** automated nightly Garmin sync with
  reconciliation, and all six MCP prompts (`morning_checkin`, `weekly_review`,
  …). Upload ergonomics from mobile is still open — see the backlog below.

What's next lives in [specs/](specs/README.md): epic 2 (web/iOS clients) is
starting exploration, and anything not yet scoped into an epic — upload
ergonomics, proactive briefings, a dashboard, second-user onboarding — is
tracked in its backlog.
