# ADR-001: Agent-first — a remote MCP server is the product surface

## Status
Accepted

## Date
2026-07-01

## Context
Corpus tracks workouts, nutrition, meds/supplements, labs, biometrics and goals for one person, with a possible second user later. Most inputs are messy: meal photos, lab PDFs, spoken workout recaps. The questions asked of the data ("what workout should I do today?", "what should I eat to hit my macros?") need reasoning across domains. Scott already pays for a Claude subscription, and the cost ceiling is under $5/month.

## Decision
The primary product surface is a **remote MCP server** that Claude (web, desktop, mobile, Claude Code) connects to as a custom connector. "Features" are MCP tools, resources and prompts. Data entry and analysis happen conversationally. LLM inference rides the existing Claude subscription, so there are no per-token API costs.

Division of labor: **the agent parses, the system validates.** The LLM handles messy input. Corpus provides precise, Zod-validated tools and owns data integrity, unit normalization and canonical naming.

The architecture keeps a custom agent app possible later (see ADR-004).

## Alternatives Considered

### Custom chat app
- Rejected: per-token API cost, and a chat UI to build and maintain, for no gain over Claude's own clients.

### MCP-only forever
- Rejected as a hard rule: the hexagonal core keeps other adapters (scheduled jobs, a dashboard, a custom agent) cheap to add later.

## Consequences
- Every capability must be expressible as a tool, resource or prompt that Claude can use well. Tool descriptions and result shapes are product design.
- Other clients (the PWA, ADR-016) are complementary interfaces over the same core, never the only home of a capability.
- Data integrity can't rely on the LLM. Validation, unit conversion (ADR-007) and dedup (ADR-008) live server-side.

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §1 #3–4, §2 #1 @ specs-archive.
