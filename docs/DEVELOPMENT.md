# Corpus — Development Workflow

Corpus is deliberately layered so almost all development happens with **zero
infrastructure**: the domain logic lives in `@corpus/core` and is exercised
against an in-memory Postgres (PGlite). You only touch Neon/Cloudflare for
end-to-end checks.

Work outward from the fastest loop; only move to a slower layer when you need
what it adds.

## Layer 1 — Core logic (your 90% inner loop)

All the real behavior — repositories, dedup/upsert, unit conversion, timezone
math, the daily summary — is in `packages/core` and needs no network. This is
where you build and test features.

```sh
npm run test:watch -w @corpus/core     # re-runs on save (PGlite, ~fast)
npm run typecheck                      # whole workspace
```

Each test spins up a throwaway Postgres with the real migration applied and a
seeded movement catalog (see `test/helpers.ts`). Adding a tool almost always
means: add/extend a repo in `src/repos/`, then a test in `test/`.

**Filtering while iterating:**

```sh
npx vitest run workouts                 # only files matching "workouts"
npx vitest -t "near-duplicate"          # only tests whose name matches
```

Or add `.only` to a `describe`/`it` and use `test:watch`.

## Layer 2 — Ad hoc scratchpad

When you just want to throw an input at a function and see what comes back —
no formal test — use the scratchpad. It sets up the same in-memory DB, seeds
movements, and creates a test user; you edit the marked "scratch zone".

```sh
npm run scratch -w @corpus/core         # run once
npm run scratch:watch -w @corpus/core   # re-run on save
```

Edit `packages/core/scripts/scratch.ts` freely — it's throwaway. Nothing in
Layers 1–2 touches your live data.

## Layer 3 — The worker, end to end

To exercise the actual Worker (OAuth + Durable Object + Neon + RLS) before
deploying, run it locally with Miniflare:

```sh
cd apps/mcp-server
npm run dev                             # wrangler dev on http://localhost:8787
```

Local secrets go in `apps/mcp-server/.dev.vars` (gitignored):

```
DATABASE_URL=postgres://...             # a Neon DEV BRANCH — see below
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

**Use a Neon dev branch, not production.** Neon branches are instant copies —
create one (`dev`) in the Neon console and use its connection string here so
local experiments never touch real data. Apply the schema + seed to it once:

```sh
export DATABASE_URL='postgres://...dev-branch...'
npm run db:migrate -w @corpus/core
npm run db:seed -w @corpus/core
```

**Driving the local MCP server.** The `/mcp` endpoint is behind OAuth, so use
the MCP Inspector, which walks the OAuth flow for you:

```sh
npx @modelcontextprotocol/inspector
# In the UI: Transport "Streamable HTTP", URL http://localhost:8787/mcp, Connect
```

For local sign-in to work, add `http://localhost:8787/callback` as a second
authorized redirect URI on your Google OAuth client (Clients tab). KV and the
Durable Object are emulated locally by `wrangler dev` automatically.

Notes:
- `wrangler dev` runs a *local* worker; it does not touch your deployed one.
- The Neon serverless driver talks over fetch/WebSocket, which works from
  Miniflare — same transport as production.

## Layer 4 — Deploy

```sh
npm run deploy -w corpus-mcp-server     # from repo root: npm run deploy
```

Or just push to `main` — CI typechecks, tests, and deploys (see
`.github/workflows`). Since this is a personal instance, deploying and testing
the real connector in Claude is itself a fine integration check; the Neon dev
branch is what keeps that safe to iterate on.

## Before you commit

```sh
npm run typecheck && npm test           # from repo root — what CI runs
```
