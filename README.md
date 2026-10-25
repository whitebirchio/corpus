# Corpus

Personal health & wellness tracking, built AI-agent-first: all data entry and
analysis happens conversationally through a remote MCP server connected to
Claude. Tracks workouts (strength / running / metcons), nutrition,
medications & supplements, labs and fitness tests, wearable biometrics, and
goals — one schema, one timeline, one place to ask *"what should I do today?"*

## Architecture

- **[CLAUDE.md](CLAUDE.md)** — architecture, invariants, commands, and the
  spec-driven workflow (agent-skills: root `SPEC.md`, `tasks/`, ADRs in
  `docs/decisions/`). Read this first.
- **[docs/decisions/](docs/decisions/README.md)** — architecture decision
  records: why Corpus is built the way it is (hosting, RLS, canonical units,
  dedup, the PWA, Garmin sync, …).
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
Invited users (no code involved) should start with
**[docs/USER-GUIDE.md](docs/USER-GUIDE.md)**.

```sh
npm install
npm test               # core tests against in-memory Postgres (PGlite)
npm run typecheck
npm run dev            # local worker on :8787
npm run deploy         # deploy to Cloudflare
```

## Status

The initial platform ([ADR-001](docs/decisions/001-agent-first-mcp-surface.md) onward)
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
  …). Upload ergonomics from mobile is still open (#7).

Later work (PWA dashboard, record edits, training plans, nutrition accuracy,
Garmin weigh-ins, macro meters) is recorded in
[docs/decisions/](docs/decisions/README.md).
What's next — ideas not yet specced, such as upload ergonomics and proactive
briefings — is tracked in
[GitHub Issues](https://github.com/whitebirchio/corpus/issues).
