# Corpus specs — epic-by-epic design history

Each subdirectory here is one major chunk of work (an "epic"), numbered in the order it was woven into the system. A subdirectory owns its own `SPEC.md` (and any supporting design docs an epic later needs) — the record of what was decided and why for that chunk of work, not a living document that gets silently rewritten as understanding changes.

This is different from [`docs/`](../docs/): `docs/` is evergreen how-to (one-time account setup, local dev workflow) that stays current; `specs/` is an append-only historical record, one entry per epic.

## Epics

1. [Initial platform](01-initial-platform/SPEC.md) — core data model, MCP server (tools/resources/prompts), auth, nightly Garmin sync. Shipped through Phase 3, minus upload ergonomics (see backlog below).
2. [PWA client](02-pwa-client/SPEC.md) — a progressive web app as a complementary, glanceable interface onto the same system/data (a first-party REST adapter over `@corpus/core`, reusing identity + RLS). Design complete 2026-07-02 (Vite+React SPA + Hono in one `apps/web` worker, first-party rolling session); read-only v1 built write-forward 2026-07-03 — see [implementation notes](02-pwa-client/IMPLEMENTATION.md) and [follow-ups](02-pwa-client/FOLLOWUPS.md) (a few one-time account steps remain before first use).
3. [Record edits](03-record-edits/SPEC.md) — edit/delete for conversationally-logged meals (full edit + delete) and workouts (delete + session-level edit) via new MCP tools; imported records stay off-limits. Shipped 2026-07-03; realizes the write-forward path anticipated by epic 2 §5.
4. [Training plans](04-training-plans/SPEC.md) — forward-looking training: goal milestones, a rolling one-week plan of fully-prescribed workouts, agent-mediated planned↔actual reconciliation, and a structured athlete model (equipment, capability estimates, constraints) the agent reinforces over time. Claude via MCP is the planning brain; Corpus stores/serves. Built 2026-07-05 (all three phases: plan core, athlete model, PWA Plan/Today views) — see [implementation notes](04-training-plans/IMPLEMENTATION.md) for deviations and the remaining manual steps (Neon migrations, layer-3 smoke test).

## Backlog — not yet scoped into an epic

Carried over from epic 1's old Phase 3/4 roadmap. These become their own epic (or fold into an existing one) once someone actually starts designing them:

- **Upload-ergonomics pass** — presigned-URL upload is clunky from a phone; needs a tiny authenticated upload page or MCP file passthrough (if/when Claude clients support it).
- **Scheduled proactive briefings** — Workers cron for daily/weekly check-ins, needs a push channel (e.g. email) since Corpus has no notification surface today.
- **Second user (wife) onboarding** — add her email to the OAuth allowlist; RLS already keeps data separate, so this is mostly just doing it.
