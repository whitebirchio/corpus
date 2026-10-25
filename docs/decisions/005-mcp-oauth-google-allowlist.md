# ADR-005: MCP auth — OAuth 2.1 with Google upstream and an email allowlist

## Status
Accepted

## Date
2026-07-01

## Context
Claude's custom connectors connect from Anthropic's cloud across web, desktop and mobile, and they expect an OAuth 2.1 authorization server with PKCE and Dynamic Client Registration (DCR). The data is sensitive health data for one person (possibly two later).

## Decision
- **Authorization server:** `workers-oauth-provider` on the same Worker. OAuth 2.1 with PKCE (S256) and DCR.
- **Upstream identity:** Google sign-in. The callback checks the verified email against an **allowlist** in config (`ALLOWED_EMAILS`) and maps it to a `users` row. Anyone else is rejected at login, so open DCR admits no data access.
- **Hardening:** secrets live in Worker secrets, never in the repo. Health data never appears in logs (tool names and record ids only). No third-party analytics or telemetry, and no public endpoints beyond the OAuth flow and `/mcp`.

## Alternatives Considered

### Bearer token / secret URL
- Rejected: not what Claude's connectors expect across all clients, and a leaked URL is a full credential.

## Consequences
- Adding a user is a config change (allowlist) plus their own Claude account. RLS (ADR-006) keeps data separate.
- The OAuth callback runs before a user exists, so it uses its own `app.auth_email` setting to reach its `users` row for find-or-create.
- The PWA reuses the same Google verification and allowlist but not the OAuth/DCR dance (ADR-018).

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §2 #10, §7, §9 @ specs-archive.
