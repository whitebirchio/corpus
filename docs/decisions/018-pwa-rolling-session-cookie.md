# ADR-018: First-party rolling session cookie for the PWA

## Status
Accepted

## Date
2026-07-02

## Context
The PWA should open throughout the day without re-authenticating. It is a first-party app Scott owns. Dynamic Client Registration exists because *Claude* is a third-party OAuth client that must self-register (ADR-005); a first-party app doesn't need that dance. iOS Safari can evict script-writable storage.

## Decision
- **Identity:** reuse the existing Google upstream verification, email allowlist and `findOrCreateUser`.
- **Session:** a **first-party httpOnly cookie**, not the OAuth 2.1/DCR flow. It is a **signed, stateless** cookie (holding only the user id) with **rolling 90-day expiry**, re-issued on each authenticated response, with no DB session lookup. The user row (timezone, units) and the allowlist are re-checked on every request, so removal from the allowlist takes effect immediately.
- **CSRF:** `SameSite=Lax` plus a required `X-Corpus-Csrf: 1` header on non-GET requests. Decided during the read-only v1 so the cookie was right before writes landed.

## Alternatives Considered

### Make the PWA an OAuth client like Claude
- Rejected: DCR solves third-party self-registration, which a first-party app doesn't need.

### Short sessions with frequent re-login
- Rejected: defeats the "pop it open" use.

### Fixed-expiry session
- Rejected in favor of a sliding window.

### Server-side session row from day one
- Deferred until remote logout is actually wanted.

### `SameSite=Strict` + header, or a double-submit token
- Rejected: Lax + header keeps external links into the app working.

## Consequences
- There is no remote logout, since there is no session table to revoke.
- httpOnly cookies survive iOS storage eviction better than script-writable storage.
- `SESSION_SECRET` is a required worker secret. Without it, auth fails.

---
Backfilled 2026-10-25 from specs/02-pwa-client/SPEC.md §2 #6–8, #15, §5 #3, IMPLEMENTATION.md §3.2 and §5, and FOLLOWUPS.md judgement calls #6–7 @ specs-archive.
