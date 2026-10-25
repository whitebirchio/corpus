# ADR-004: Hexagonal core with thin adapters

## Status
Accepted

## Date
2026-07-01

## Context
The MCP server is the first interface (ADR-001), but others were anticipated: scheduled jobs, a dashboard, a custom agent app. Domain logic (dedup, unit conversion, timezone math, reconciliation) is where bugs cost real data. It needs to be testable without a network, Workers or MCP.

## Decision
All domain logic and persistence live in **`@corpus/core`** (`packages/core`). It contains the Drizzle schema, Zod schemas, unit conversion, timezone handling and the repository layer, with **no MCP or HTTP dependencies**. It runs against any Postgres.

Adapters are thin `validate → call repo → echo result` shells:
- `apps/mcp-server`: MCP tools/resources/prompts (2026-07-01)
- `apps/web`: a REST adapter for the PWA (2026-07-02, ADR-017). The core boundary is unchanged; the REST adapter is just another spoke.
- `apps/garmin-sync` → `/garmin/ingest`: forwards raw data only; mapping lives in core (ADR-014)

**External HTTP behind ports** (2026-07-18): when core needed outside data (nutrition databases, ADR-025), it got a `NutritionSource` interface plus pure normalization/ranking logic. The FDC/OFF HTTP clients are thin fetch adapters in the workers.

## Alternatives Considered

### Logic in the MCP worker
- Rejected: couples behavior to one transport and makes testing need Workers/MCP.

### HTTP dependencies in core (for the REST adapter or nutrition APIs)
- Rejected both times: it would break the boundary that keeps core fixture-testable.

## Consequences
- Tests run against PGlite (in-memory Postgres) with the real migrations; about 90% of development needs no network.
- Adding a capability means: extend a repo, add a Zod shape, add a test, then wrap it in the adapter.
- PGlite tests run as superuser and bypass RLS, so repos also filter by `user_id` explicitly (ADR-006).

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §1 #7, §3; specs/02-pwa-client/SPEC.md §2 #5; specs/05-nutrition-accuracy/SPEC.md §2 #8 @ specs-archive.
