# ADR-021: Claude via MCP is the planning brain; no server-side LLM calls

## Status
Accepted

## Date
2026-07-05

## Context
Forward-looking training needs real planning judgment: drafting a week, adapting it to recovery, weather and missed sessions, and learning from adherence. That could live in Corpus (a server calling an LLM API) or in the agent that's already in the conversation.

## Decision
Planning happens in **Claude via MCP**: prompts plus tools, with no server-side LLM calls. Corpus stores and serves the plan and the athlete model; the agent drafts, revises and reconciles.

## Alternatives Considered

### A scheduled auto-draft (Workers cron + Claude API)
- Deferred to the backlog. It would layer on cleanly later because it would call the same core functions.

## Consequences
- Zero new infra or API cost (ADR-001, ADR-003). The agent that plans is the one that knows the conversation's context.
- Planning quality depends on the context tools give the agent, which is why the athlete-model digest is a tool (ADR-024).
- Live signals the agent can fetch itself stay out of Corpus. **Weather:** Corpus stores `users.home_location` (written by a `set_home_location` tool) plus seasonal `planning_constraints`; the agent checks the forecast itself. There's no weather API integration.

---
Backfilled 2026-10-25 from specs/04-training-plans/SPEC.md §2 #1, #9 and IMPLEMENTATION.md "Deviations" @ specs-archive.
