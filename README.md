# Corpus

Personal health & wellness tracking, built AI-agent-first: all data entry and
analysis happens conversationally through a remote MCP server connected to
Claude. Tracks workouts (strength / running / metcons), nutrition,
medications & supplements, labs and fitness tests, wearable biometrics, and
goals — one schema, one timeline, one place to ask *"what should I do today?"*

## Architecture

- **[SPEC.md](SPEC.md)** — the full system specification (data model, MCP
  surface, auth, idempotency, phases). Read this first.
- **`packages/core`** — domain core: Drizzle schema, Zod tool schemas, unit
  conversion (canonical metric storage), timezone handling, repositories with
  dedup/upsert semantics. No MCP or HTTP dependencies.
- **`apps/mcp-server`** — Cloudflare Worker: OAuth 2.1 (Google upstream, email
  allowlist) via `workers-oauth-provider`, MCP over Streamable HTTP via the
  Agents SDK (`McpAgent`), RLS-scoped Neon Postgres access.

Runs at ~$0/month on Cloudflare + Neon free tiers.

## Getting started

See **[docs/SETUP.md](docs/SETUP.md)** for one-time account setup
(Neon, Google OAuth, Cloudflare, Claude connector).

```sh
npm install
npm test               # core tests against in-memory Postgres (PGlite)
npm run typecheck
npm run dev            # local worker on :8787
npm run deploy         # deploy to Cloudflare
```

## Status

Phase 1 (core daily loop) implemented: check-ins, workouts, meals, regimen,
goals, insights, daily summary, and read-only SQL analysis. Phase 2 (documents,
labs, baseline imports) is next — see SPEC.md §10.
