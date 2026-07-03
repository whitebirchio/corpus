# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Corpus is a personal health-tracking system (workouts, nutrition, meds/supplements, labs, biometrics, goals) that is **AI-agent-first**: the primary product surface is a remote MCP server that Claude connects to as a custom connector, so "features" are MCP tools/resources/prompts, and daily interaction (both data entry and analysis) happens conversationally. A read-only **PWA dashboard** (`apps/web`, epic 2) is a complementary, glanceable second interface over the same core — never a PWA-only capability.

## Commands

Run from the repo root unless noted. The inner loop is almost always Layer 1 (core, no network).

```sh
npm run typecheck                      # whole workspace (what CI runs)
npm test                               # whole workspace (core vitest against PGlite)
npm run typecheck && npm test          # run before committing — mirrors CI

# Core package (packages/core) — where ~90% of work happens:
npm run test:watch -w @corpus/core     # re-run on save
npx vitest run workouts                # (in packages/core) only files matching "workouts"
npx vitest -t "near-duplicate"         # (in packages/core) only tests whose name matches
npm run scratch:watch -w @corpus/core  # ad-hoc REPL — edit scripts/scratch.ts, throwaway

# Schema changes (Drizzle):
npm run db:generate -w @corpus/core    # generate a migration after editing src/db/schema.ts
npm run db:migrate -w @corpus/core     # apply to DATABASE_URL (use a Neon DEV BRANCH, never prod)
npm run db:seed -w @corpus/core        # seed movement catalog

# Worker (apps/mcp-server), Layer 3+:
npm run dev                            # wrangler dev on :8787 (needs apps/mcp-server/.dev.vars)
npm run deploy                         # deploy to Cloudflare (or just push to main; CI deploys)

# PWA (apps/web) — REST adapter + React SPA in one worker:
npm run dev:web                        # vite build + wrangler dev on :8788 (needs apps/web/.dev.vars)
npm run dev:ui -w corpus-web           # Vite HMR on :5173, proxying /api + /auth to :8788
npm run deploy:web                     # deploy corpus-app (CI also deploys on main)
```

Driving the local worker's OAuth-gated `/mcp` endpoint: `npx @modelcontextprotocol/inspector` (Transport "Streamable HTTP", URL `http://localhost:8787/mcp`). See `docs/DEVELOPMENT.md` for the full 4-layer workflow and Neon dev-branch setup; `docs/SETUP.md` for one-time account setup.

## Architecture

**Hexagonal core + thin adapters.** All domain logic lives in `packages/core` (`@corpus/core`) — Drizzle schema, Zod schemas, unit conversion, timezone math, and the repository layer with dedup/upsert semantics. It has **no MCP or HTTP dependencies** and runs against any Postgres. `apps/mcp-server` is a Cloudflare Worker that is a thin MCP adapter over it; `apps/web` is a second worker that is a thin REST adapter (Hono) plus the static PWA bundle (Vite + React, same origin, first-party session cookie — see `specs/02-pwa-client/`); `apps/garmin-sync` is a Python GitHub Actions job. When adding a capability, the logic and its tests belong in core; the tool/route wrapper in a worker should stay a thin validate → call-repo → echo-result shell.

**Request path (worker):** `apps/mcp-server/src/index.ts` wires `OAuthProvider` (OAuth 2.1 authz server facing Claude + router). `/mcp` → `CorpusMcpAgent` (a per-session Durable Object, `mcp.ts`) which registers tools (`tools.ts`), resources (`schemaDoc.ts`, `profile.ts`), and prompts (`prompts.ts`). Everything else → Google login handler (`auth/google.ts`), gated by a hard **email allowlist**.

**Data access & security is layered, not optional:**

- Every tool call goes through `withUserDb(env, userId, fn)` (`apps/mcp-server/src/db.ts`), which opens a Neon transaction and sets `app.user_id`. **Postgres RLS** on every user-owned table scopes all statements to that user — including the raw-SQL `query_data` tool, which additionally runs as a SELECT-only role with a row cap and statement timeout.
- `user_id` is denormalized onto child tables so every RLS policy is the same single-column check. Repos also filter by `user_id` explicitly (belt-and-braces; PGlite tests run as superuser and bypass RLS).
- The OAuth callback (no user yet) uses `withAuthDb` + `app.auth_email` to reach its own row for find-or-create.

**Two hard invariants:**

- **Canonical metric storage**: kg, meters, seconds, kcal. Tools accept unit-tagged `{ value, unit }` and the server converts (`core/units.ts`). The LLM never does unit math; conversion never happens in a tool handler.
- **snake_case casing**: every `drizzle(client, { casing: "snake_case" })` call AND `drizzle.config.ts` must set this. Column props are camelCase in TS, snake_case in the DB.

**Dedup is a first-class requirement** (`core` §5.9): no write blindly inserts. Three tiers — content hash (`documents.sha256`), natural-key `ON CONFLICT` upsert (e.g. `daily_metrics` on `(user_id, local_date)`, imports keyed on `source_ref`), and agent-mediated soft-match for records with no stable identity (conversational meals/workouts), which returns candidates for the agent to confirm rather than guessing. Every importer is safely re-runnable.

**Garmin sync** (`apps/garmin-sync/sync.py`, Python — the Workers sandbox can't run the `garminconnect` library) pulls a trailing window nightly and POSTs raw JSON to `/garmin/ingest`; **all mapping/reconciliation lives in `packages/core/src/import/garmin.ts`** (one write path, PGlite-tested). Backfill = re-run the pull; idempotent merges repopulate the window.

## Testing

Tests live in `packages/core/test/` and run against **PGlite** (in-memory Postgres). `test/helpers.ts` applies the real migrations from `drizzle/*.sql` in order and seeds the movement catalog — so **after editing `src/db/schema.ts` you must `npm run db:generate` or tests run against a stale schema.** Adding a tool typically means: extend a repo in `src/repos/`, add a Zod shape in `src/schemas/`, add a test, then wrap it as a tool in `apps/mcp-server/src/tools.ts`.

## Specs & docs

`specs/` is the append-only design history, one subdirectory per epic (`NN-slug`), ordered by when the work shipped. `specs/01-initial-platform/SPEC.md` is the authoritative reference for the data model (§5), MCP surface (§6), auth (§7), flows (§8), and idempotency (§5.9) — code comments cite it by section. `specs/README.md` indexes epics and holds the backlog. `docs/` is evergreen how-to (setup, dev workflow); don't put design rationale there.
