# ADR-003: Host on Cloudflare Workers + Neon Postgres + R2

## Status
Accepted

## Date
2026-07-01

## Context
Constraints: TypeScript everywhere, and a cost ceiling under $5/month (ideally $0). The workload is personal-scale: tens of tool calls a day, a few MB of new data a month, plus occasional original documents (PDFs, photos). The MCP server must be reachable from Anthropic's cloud over Streamable HTTP, with OAuth.

## Decision
- **Runtime:** Cloudflare Workers, using the Agents SDK `McpAgent` (a per-session Durable Object) for the MCP server.
- **Database:** Neon Postgres (serverless driver over HTTP/WebSocket, which works from Workers), with Drizzle ORM and drizzle-kit migrations.
- **Object storage:** Cloudflare R2 for original documents, in a private bucket.
- **CI/CD:** GitHub Actions → `wrangler deploy` on `main`.

Estimated cost: $0/month on free tiers. If Workers' free limits ever pinch, the paid tier ($5/month) equals the budget ceiling.

## Alternatives Considered

### Vercel
- Not chosen. The specs recorded only the final choice, without per-option rationale.

### Fly.io
- Not chosen. The specs recorded only the final choice, without per-option rationale.

### AWS
- Not chosen. The specs recorded only the final choice, without per-option rationale.

## Consequences
- **Neon scale-to-zero:** the first query after idle pays a ~0.5–1s cold start, which is acceptable for conversational use.
- **Neon 0.5 GB storage:** years of headroom; bulky originals go to R2 (ADR-009).
- **Workers 10ms CPU per invocation:** fine for validate-and-write tools; bulk imports are chunked (ADR-014).
- Code that needs raw sockets can't run in Workers. This later shaped the Garmin sync (ADR-014).
- Free-tier pricing was verified 2026-07 and may drift. That's a known risk, with the $5/month paid tier as the fallback.

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §1 #1–2, §2 #9, §4, §11 #3 @ specs-archive.
