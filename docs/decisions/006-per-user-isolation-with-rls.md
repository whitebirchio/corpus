# ADR-006: Per-user isolation with Postgres row-level security

## Status
Accepted

## Date
2026-07-01

## Context
This is sensitive health data. It starts single-user, but a second user (Scott's wife) was anticipated from day one, and adding one should be a data change, not a schema change. The agent also gets a raw-SQL `query_data` tool for ad-hoc analysis, so isolation can't depend only on the repo layer's `WHERE` clauses.

## Decision
- Every domain table carries `user_id`. Child tables carry it too (denormalized), so **every RLS policy is the same single-column check**: `user_id = current_setting('app.user_id')`.
- Every DB session sets `app.user_id`: tool calls go through `withUserDb(env, userId, fn)`, which opens a transaction and sets it.
- **Postgres RLS** on all user-owned tables scopes every statement, including the raw `query_data` tool. That tool additionally runs as a SELECT-only role with a statement timeout and a row cap.
- Repos also filter by `user_id` explicitly (belt-and-braces).

## Alternatives Considered

### Application-level filtering only
- Not recorded as a considered option in the specs. It's implicitly ruled out by exposing raw SQL to the agent.

## Consequences
- Adding a user means adding an email to the allowlist (ADR-005); RLS keeps the data fully separate.
- PGlite tests run as superuser and bypass RLS, which is why the explicit repo filter matters (ADR-004).
- The OAuth callback, which runs before a user exists, uses a separate `app.auth_email` setting (`withAuthDb`) to reach its own `users` row.
- New adapters must reuse the same `withUserDb` path. The PWA's REST adapter does (ADR-017).

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §1 #5, §5, §7, §9; specs/02-pwa-client/SPEC.md §2 #9 @ specs-archive.
