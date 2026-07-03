# Corpus specs — epic-by-epic design history

Each subdirectory here is one major chunk of work (an "epic"), numbered in the order it was woven into the system. A subdirectory owns its own `SPEC.md` (and any supporting design docs an epic later needs) — the record of what was decided and why for that chunk of work, not a living document that gets silently rewritten as understanding changes.

This is different from [`docs/`](../docs/): `docs/` is evergreen how-to (one-time account setup, local dev workflow) that stays current; `specs/` is an append-only historical record, one entry per epic.

## Epics

1. [Initial platform](01-initial-platform/SPEC.md) — core data model, MCP server (tools/resources/prompts), auth, nightly Garmin sync. Shipped through Phase 3, minus upload ergonomics (see backlog below).
2. [Web / iOS clients](02-web-ios-clients/SPEC.md) — exploring a web app and/or iOS app as an additional interface into the same system/data. Exploration started 2026-07-02; no design decisions yet.

## Backlog — not yet scoped into an epic

Carried over from epic 1's old Phase 3/4 roadmap. These become their own epic (or fold into an existing one) once someone actually starts designing them:

- **Upload-ergonomics pass** — presigned-URL upload is clunky from a phone; needs a tiny authenticated upload page or MCP file passthrough (if/when Claude clients support it).
- **Scheduled proactive briefings** — Workers cron for daily/weekly check-ins, needs a push channel (e.g. email) since Corpus has no notification surface today.
- **Read-only dashboard** — a non-conversational view onto the same data. May end up folding into the web-client epic rather than staying separate.
- **Second user (wife) onboarding** — add her email to the OAuth allowlist; RLS already keeps data separate, so this is mostly just doing it.
