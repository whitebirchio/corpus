# ADR-016: A PWA as a complementary client, never PWA-only

## Status
Accepted

## Date
2026-07-02

## Context
Once v1 was live as MCP-only (ADR-002), some cases favored a glanceable UI over a chat turn: checking today's macros on a phone, scanning trends, and later fixing a bad value or deleting a duplicate. The conversational surface remains the product (ADR-001).

## Decision
Add a **progressive web app**: a responsive web app installable to the iOS home screen, as a second, **complementary** interface over the same core and data. Every operation the PWA supports must remain available conversationally; there is **no PWA-only capability**. v1 is **read-only** (today's macros vs. target, trends) and built write-forward, so edits slot in later (ADR-019).

This supersedes ADR-002.

## Alternatives Considered

### Native Swift/SwiftUI app
- Deferred, not rejected. It needs a separate Swift codebase (no reuse of the TS stack), Xcode, the $99/year Apple Developer Program, and signing/TestFlight for a single-user app, for about 10% more polish.
- Revisit on a concrete trigger the PWA can't satisfy:
  - home-screen or lock-screen widgets
  - Siri/Shortcuts voice logging
  - reliable background refresh and push

  The REST API (ADR-017) would serve a native client equally well.

### Plain responsive web (no install)
- Not chosen. The spec records no separate rationale, though it notes that installed PWAs get more durable storage (ADR-018).

### Both PWA and native
- Not chosen. The native costs above apply.

### Read+write from day one
- Not chosen. Writes were a deliberate later phase, with the read-only v1 built so they could slot in.

### Read-only forever
- Not chosen, for the same reason.

## Consequences
- The rule "never PWA-only" shaped later work. The barcode scanner (2026-07-18) landed in core and MCP first (`lookup_barcode`), with the PWA's Scan tab as a client of it (ADR-025).
- Read payloads expose `id`/`source`/`granularity`/`estimateConfidence`, and routes are REST resources, so `PATCH`/`DELETE` slot in without restructuring.

---
Backfilled 2026-10-25 from specs/02-pwa-client/SPEC.md §1, §2 #1–2, #10, §5, §6; specs/05-nutrition-accuracy/SPEC.md §2 #7 @ specs-archive.
