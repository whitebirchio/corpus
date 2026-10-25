# Architecture decision records

Why Corpus is built the way it is. Each ADR follows the `documentation-and-adrs` template. ADRs are never deleted: a decision that changes gets a new ADR that supersedes the old one.

ADRs 001–027 were backfilled on 2026-10-25 from the epic specs that preceded the agent-skills workflow. Each one is dated to when the decision was actually made and ends with the source it came from. Those specs are kept under the git tag `specs-archive`, e.g. `git show specs-archive:specs/01-initial-platform/SPEC.md`.

| ADR | Title | Status | Date |
|---|---|---|---|
| [001](001-agent-first-mcp-surface.md) | Agent-first: a remote MCP server is the product surface | Accepted | 2026-07-01 |
| [002](002-no-web-ui-in-v1.md) | No web UI in v1 | Superseded by 016 | 2026-07-01 |
| [003](003-cloudflare-neon-r2-hosting.md) | Host on Cloudflare Workers + Neon Postgres + R2 | Accepted | 2026-07-01 |
| [004](004-hexagonal-core.md) | Hexagonal core with thin adapters | Accepted | 2026-07-01 |
| [005](005-mcp-oauth-google-allowlist.md) | MCP auth: OAuth 2.1 with Google upstream and an email allowlist | Accepted | 2026-07-01 |
| [006](006-per-user-isolation-with-rls.md) | Per-user isolation with Postgres row-level security | Accepted | 2026-07-01 |
| [007](007-canonical-metric-storage.md) | Canonical metric storage; the server does all unit conversion | Accepted | 2026-07-01 |
| [008](008-three-tier-dedup.md) | Every write is dedup-aware: three tiers | Accepted | 2026-07-01 |
| [009](009-keep-original-documents.md) | Keep original documents in R2, linked to extracted records | Accepted | 2026-07-01 |
| [010](010-record-granularity.md) | Record granularity: hybrid nutrition, modality-aware workouts | Accepted | 2026-07-01 |
| [011](011-regimen-plus-exceptions.md) | Medications and supplements as a regimen plus logged exceptions | Accepted | 2026-07-01 |
| [012](012-fresh-start-plus-baselines.md) | Fresh start plus baseline imports, no full historical backfill | Accepted | 2026-07-01 |
| [013](013-garmin-via-manual-export-imports.md) | Biometrics via check-in plus periodic Garmin export imports | Superseded by 014 | 2026-07-01 |
| [014](014-nightly-garmin-sync.md) | Nightly Garmin sync via the unofficial API in GitHub Actions | Accepted | 2026-07-02 |
| [015](015-drop-macrofactor-import.md) | Drop the MacroFactor import; conversational meal logging is the entry path | Accepted | 2026-07-02 |
| [016](016-pwa-complementary-client.md) | A PWA as a complementary client, never PWA-only | Accepted | 2026-07-02 |
| [017](017-web-worker-rest-adapter.md) | The `apps/web` worker: a Hono REST adapter plus a Vite/React SPA on one origin | Accepted | 2026-07-02 |
| [018](018-pwa-rolling-session-cookie.md) | First-party rolling session cookie for the PWA | Accepted | 2026-07-02 |
| [019](019-only-conversation-records-editable.md) | Only conversation-sourced records are editable | Accepted | 2026-07-03 |
| [020](020-structured-status-unions.md) | Mutations return structured status unions, not thrown errors | Accepted | 2026-07-03 |
| [021](021-claude-is-the-planning-brain.md) | Claude via MCP is the planning brain; no server-side LLM calls | Accepted | 2026-07-05 |
| [022](022-training-plan-model.md) | Training plans: separate `planned_*` tables, one plan per calendar week | Accepted | 2026-07-05 |
| [023](023-agent-mediated-plan-linking.md) | Agent-mediated planned↔actual linking, an in-transaction change log, and a structured athlete model | Accepted | 2026-07-05 |
| [024](024-tools-over-resources-for-critical-context.md) | Context the agent must have is a tool, not an MCP resource | Accepted | 2026-07-05 |
| [025](025-food-catalog-and-nutrition-sources.md) | Personal food catalog plus USDA FDC / Open Food Facts, with agent-confirmed matches | Accepted | 2026-07-18 |
| [026](026-garmin-weigh-ins-source-of-truth.md) | Garmin Connect is the weigh-in source of truth | Accepted | 2026-10-23 |
| [027](027-nutrition-targets-are-maxima.md) | All nutrition targets are maxima, protein included | Accepted | 2026-10-24 |
