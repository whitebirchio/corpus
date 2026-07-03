# Web / iOS clients — epic spec

**Status:** Exploration started 2026-07-02
**Owner:** Scott Schmalz

## Motivating context

Today Corpus is MCP-only: all data entry and analysis happens conversationally through Claude (web/desktop/mobile), per [specs/01-initial-platform/SPEC.md](../01-initial-platform/SPEC.md) principle 3 ("agent-first interaction, no UI in v1"). This epic explores adding a web app and/or iOS app as an additional interface into the same underlying system and data — not a replacement for the conversational surface, but a second way in for cases where a UI (charts, quick logging, glanceable status) beats a chat turn.

No design decisions have been made yet. This doc starts as a scaffold and grows as the epic is actually designed.

## Open questions

- Native (Swift) vs. PWA vs. responsive web-only, for the first client.
- New API layer on `@corpus/core` vs. reusing/extending the existing MCP surface — does a client talk to a new HTTP API, or does it act as another MCP client itself?
- Auth reuse (the existing Google OAuth 2.1 + allowlist flow) vs. a separate session model for a non-Claude client.
- Whether this changes `@corpus/core`'s "no MCP/HTTP dependencies" boundary (principle 7 in epic 1's spec) — does serving a new client require a new adapter package, same as `apps/mcp-server` is today?
- Relationship to the [specs/README.md](../README.md) backlog's "read-only dashboard" item — that may fold into this epic rather than staying separate.

## Decisions

_(none yet — append entries here as they're made, in the style of [specs/01-initial-platform/SPEC.md §2](../01-initial-platform/SPEC.md))_
