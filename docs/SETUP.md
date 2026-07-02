# Corpus — First-Time Setup

One-time account setup that only you can do (all free tiers). Steps are ordered;
each takes a few minutes. When you're done, Corpus is a connector in your
Claude apps.

## 1. Neon (database)

1. Create a project at [neon.tech](https://neon.tech) (free plan) — name it `corpus`,
   region close to you (US East).
2. Copy the **connection string** (pooled) from the dashboard — you'll use it as
   `DATABASE_URL` below.
3. Apply the schema and seed the movement catalog:

   ```sh
   export DATABASE_URL='postgres://...'   # from step 2
   npm run db:migrate -w @corpus/core
   npm run db:seed -w @corpus/core
   ```

4. **RLS role** — the app currently connects as the Neon default role, which owns
   the tables and therefore *bypasses RLS*. RLS matters as defense-in-depth for
   `query_data` and becomes load-bearing with a second user. Create an app role
   and use *its* connection string as `DATABASE_URL` instead (SQL editor in Neon
   console):

   ```sql
   create role corpus_app with login password '<generate-a-strong-password>';
   grant usage on schema public to corpus_app;
   grant select, insert, update, delete on all tables in schema public to corpus_app;
   alter default privileges in schema public grant select, insert, update, delete on tables to corpus_app;
   ```

   Then build the connection string with `corpus_app` as the user (host/db from
   the dashboard). Migrations still run with the default role.

## 2. Google OAuth (upstream identity)

1. In [Google Cloud Console](https://console.cloud.google.com) create a project
   (`corpus`), then go to **APIs & Services → OAuth consent screen** (this now
   opens the **Google Auth Platform** page, tabs: Branding / Audience / Clients):
   - **Branding**: app name "Corpus", your support + developer contact email,
     **External** user type.
   - **Audience** tab → **Test users → + Add users** → add your Google email
     (must match `ALLOWED_EMAILS` in `wrangler.jsonc`). Leave the app in
     "Testing" — publishing/verification is not needed. At sign-in you'll get an
     "unverified app" warning; click **Advanced → Go to Corpus** to proceed.
2. **Clients tab (or Credentials) → Create client → Web application**:
   - Authorized redirect URI: `https://corpus-mcp.<your-subdomain>.workers.dev/callback`
     (you'll know the exact hostname after the first deploy — you can come back
     and update this; the flow fails cleanly until it matches.)
3. Note the **Client ID** and **Client Secret**.

## 3. Cloudflare (hosting)

1. Sign up / log in at [dash.cloudflare.com](https://dash.cloudflare.com), then:

   ```sh
   cd apps/mcp-server
   npx wrangler login
   npx wrangler kv namespace create OAUTH_KV
   ```

2. Paste the returned KV namespace `id` into `wrangler.jsonc` (replacing
   `REPLACE_WITH_KV_NAMESPACE_ID`).
3. Set secrets:

   ```sh
   npx wrangler secret put DATABASE_URL          # corpus_app connection string
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

4. Deploy:

   ```sh
   npm run deploy -w corpus-mcp-server
   ```

   Note the deployed URL (`https://corpus-mcp.<subdomain>.workers.dev`) and make
   sure the Google redirect URI from step 2.2 matches `<url>/callback`.

## 4. CI deploys (optional but recommended)

1. Create a Cloudflare API token (dash → My Profile → API Tokens →
   "Edit Cloudflare Workers" template).
2. Add it as the `CLOUDFLARE_API_TOKEN` secret in the GitHub repo settings.
   Pushes to `main` then typecheck, test, and deploy automatically.

## 5. Connect Claude

1. In Claude (web or mobile) → **Settings → Connectors → Add custom connector**.
2. URL: `https://corpus-mcp.<subdomain>.workers.dev/mcp`
3. Claude registers itself (Dynamic Client Registration), sends you through
   Google sign-in, and your email allowlist (in `wrangler.jsonc` vars) is the gate.
4. Smoke test in a chat: *"Use the get_daily_summary tool"* — an empty-but-valid
   summary means the whole path (OAuth → DO → Neon RLS) works.

## 6. Adding a second user later

1. Add their email to `ALLOWED_EMAILS` in `wrangler.jsonc`; redeploy.
2. They add the connector in their own Claude account and sign in with Google.
   RLS keeps all data separate. That's it.

## Local development

```sh
# .dev.vars in apps/mcp-server (gitignored) for local secrets:
#   DATABASE_URL=postgres://...
#   GOOGLE_CLIENT_ID=...
#   GOOGLE_CLIENT_SECRET=...
npm run dev            # wrangler dev on http://localhost:8787
npm test               # core test suite (in-memory Postgres via PGlite)
npm run typecheck
```

For a local OAuth flow, add `http://localhost:8787/callback` as a second
redirect URI on the Google client.
