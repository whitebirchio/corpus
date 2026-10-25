# Spec: Migrate the `specs/` archive into agent-skills artifacts

## Objective

Make the repo look as if it had used the agent-skills workflow from day one. Under that workflow, each feature's `SPEC.md` is a living document for the work in progress; once the work ships, the spec survives only in git history. What lasts is the **ADRs** (the *why*), the code and tests (the *what*), `CLAUDE.md` (the rules), and the issue tracker (what's next). The archived epic specs in `specs/01–07` hold all four kinds of content mixed together. This work sorts them out:

1. **Backfill ADRs** in `docs/decisions/` from the specs' decision logs, guiding principles, and any implementation-note deviations that changed a decision.
2. **Re-point or remove the 91 code-comment citations** of `specs/` (in 51 files), so nothing in the code depends on the archive.
3. **Move still-open follow-ups** to GitHub Issues.
4. **Retire `specs/`**: delete it, with a git tag preserving the last tree that contains it.

Audience: Scott and future agent sessions. The test of success: an agent asking "why is X built this way?" finds an ADR, and an agent asking "what's next?" finds an issue. Neither needs to open `specs/`.

### Honesty rule for backfilled ADRs

Each ADR's `Date` is when the decision was actually made, taken from the spec text or the git date the spec was added. `Status` reflects what happened later, so a decision reversed in a later epic is `Superseded by ADR-NNN`. Each ADR ends with a provenance line: `Backfilled 2026-10-25 from specs/NN-slug/SPEC.md §2 #N @ specs-archive`. Alternatives come only from what the specs recorded; nothing is invented after the fact.

### ADRs to write

All 27 are approved (Scott, 2026-10-25), numbered in decision order. The bold rows were offered as cut candidates and kept.

| ADR | Date | Decision | Source |
|---|---|---|---|
| 001 | 2026-07-01 | Agent-first: the remote MCP server is the product surface; inference rides the Claude subscription | 01 §1 #3, §2 #1 |
| 002 | 2026-07-01 | No web UI in v1 — *Superseded by 016* | 01 §2 #2 |
| 003 | 2026-07-01 | Cloudflare Workers + Neon Postgres + R2 under a <$5/mo ceiling | 01 §1 #2, §2 #9, §4 |
| 004 | 2026-07-01 | Hexagonal core: `@corpus/core` has no MCP/HTTP dependencies; adapters are thin; external HTTP sits behind core-defined ports | 01 §1 #7, 02 §2 #5, 05 §2 #8 |
| 005 | 2026-07-01 | MCP auth: OAuth 2.1 + Dynamic Client Registration (DCR) via `workers-oauth-provider`, Google upstream, email allowlist | 01 §2 #10, §7 |
| 006 | 2026-07-01 | Per-user isolation with Postgres RLS (row-level security), denormalized `user_id`, SELECT-only `query_data` role | 01 §1 #5, §7 |
| 007 | 2026-07-01 | Canonical metric storage; the server converts unit-tagged input, the LLM never does unit math | 01 §1 #4, §11 #4; 04 §2 #10 |
| 008 | 2026-07-01 | Three-tier dedup: content hash, natural-key upsert, agent-confirmed soft match | 01 §5.9 |
| 009 | 2026-07-01 | Keep original documents in R2, linked to the records extracted from them | 01 §1 #6, §2 #4 |
| **010** | 2026-07-01 | Record granularity: hybrid nutrition, modality-aware workouts | 01 §2 #5–6 |
| **011** | 2026-07-01 | Meds/supplements as a regimen plus logged exceptions | 01 §2 #7 |
| **012** | 2026-07-01 | Fresh start plus baseline imports, no full backfill | 01 §1 #8, §2 #3 |
| 013 | 2026-07-01 | Biometrics via manual Garmin export imports — *Superseded by 014* | 01 §2 #8 (original choice) |
| 014 | 2026-07-02 | Nightly Garmin pull via the unofficial API in GitHub Actions; the Python job only forwards data; all mapping lives in core | 01 §2 #8, §8.4, §11 #8; 06 §2 #1 |
| 015 | 2026-07-02 | Drop the MacroFactor import; conversational `log_meal` is the nutrition entry path | 01 §2 #8b |
| 016 | 2026-07-02 | PWA (not native iOS), a complementary client and never PWA-only; supersedes 002 | 02 §2 #1–2, #10; 05 §2 #7 |
| 017 | 2026-07-02 | `apps/web` worker: Hono REST adapter + Vite/React SPA on one origin, separate from MCP | 02 §2 #3–4, #12, #14 |
| 018 | 2026-07-02 | First-party rolling signed-cookie session (90 days); CSRF via `SameSite=Lax` + custom header | 02 §2 #6–8, #15; FOLLOWUPS #6–7 |
| 019 | 2026-07-03 | Only `source = conversation` records are editable; imported records are immutable | 02 §2 #11; 03 §2 #1 |
| **020** | 2026-07-03 | Mutations return structured status unions, not thrown errors | 03 §2 #4 |
| 021 | 2026-07-05 | Claude via MCP is the planning brain; no server-side LLM calls | 04 §2 #1 |
| 022 | 2026-07-05 | Training plans: separate `planned_*` tables, one plan per calendar week, uniform prescriptions, re-plan replaces only upcoming sessions | 04 §2 #2–4, #11 |
| 023 | 2026-07-05 | Agent-mediated planned↔actual linking; the `plan_changes` log is written in the same transaction | 04 §2 #6–7 |
| 024 | 2026-07-05 | Context the agent must have is exposed as a tool, not an MCP resource (resource surfacing is unreliable) | 04 §2 #13 |
| 025 | 2026-07-18 | Personal food catalog + USDA FDC / Open Food Facts; agent-confirmed matches; a failed match never blocks a log | 05 §2 #1, #3–6 |
| 026 | 2026-10-23 | Garmin is the weigh-in source of truth; deletes reconciled only inside the fetched window; check-in never asks for weight | 06 §2 #2–5, #7, #9 + IMPLEMENTATION live-data notes |
| 027 | 2026-10-24 | All nutrition targets are maxima, protein included | 07 §1 |

Epic 4 decisions #5, #8, #9, #12 and epic 2's frontend picks (Recharts, null-not-zero buckets, Monday weeks) are folded into the ADRs above as consequences, not given ADRs of their own.

### Code citations (91 references in 51 files)

- **Rationale citations** (decision-log `§2 #N`, §5.9, §7, §1) → re-pointed to the matching ADR, e.g. `// Rolling session (ADR-018): …`.
- **Structural citations** (`per §6.1`, `§5.6 lab schema`, `§3.2 core`) → removed, or replaced with a short inline statement of the fact when the code isn't self-explanatory. The schema, the tool definitions and the tests are now the source of truth for *what*.
- Only comment text changes. Code behavior is unchanged.

## Tech Stack

Markdown docs and TypeScript/Python comments only. No dependency changes.

## Commands

```
Typecheck:   npm run typecheck
Tests:       npm test
Python:      python -m py_compile apps/garmin-sync/sync.py
Leftovers:   grep -rnE "specs/|SPEC[ 0-9]*§|SPEC \d\d" apps packages docs README.md CLAUDE.md .github --exclude-dir=node_modules
Issues:      gh issue create --title "…" --body-file …
Archive tag: git tag specs-archive <last commit with specs/>   (pushed with the branch)
```

## Project Structure

```
docs/decisions/NNN-kebab-title.md   → one ADR per file, heading "# ADR-NNN: Title"
docs/decisions/README.md            → index: number, title, status, date
specs/                              → deleted (tag specs-archive keeps it)
CLAUDE.md, README.md                → links re-pointed from specs/ to docs/decisions/
apps/**, packages/**                → comment-only citation edits
```

## Code Style

ADRs use the `documentation-and-adrs` template exactly (Status, Date, Context, Decision, Alternatives Considered, Consequences), plus the provenance line:

```markdown
# ADR-018: First-party rolling session cookie for the PWA

## Status
Accepted

## Date
2026-07-02

## Context
The PWA is a first-party app Scott owns. DCR exists because Claude is a third-party OAuth client …

## Decision
A signed, stateless httpOnly cookie with a 90-day sliding expiry, re-issued on each request …

## Alternatives Considered
### Make the PWA an OAuth client like Claude
- Rejected: DCR solves third-party self-registration, which a first-party app doesn't need.

## Consequences
- No session table, so there is no remote logout (deferred until wanted) …

---
Backfilled 2026-10-25 from specs/02-pwa-client/SPEC.md §2 #6–8, #15 and FOLLOWUPS.md judgement calls #6–7 @ specs-archive.
```

Code comments keep their current density and voice; only the citation token changes, e.g. `(SPEC §2 #8)` → `(ADR-018)`.

## Testing Strategy

No new automated tests; this is docs and comments. Verification:
- `npm run typecheck && npm test` pass (proves the comment edits broke nothing).
- `python -m py_compile apps/garmin-sync/sync.py` and the sync.py tests pass.
- The leftovers grep returns nothing.
- Every `ADR-NNN` cited in code has a matching file in `docs/decisions/`.
- Every ADR has all six template sections plus a provenance line, and every Superseded ADR names an ADR that exists.
- Every relative link in `CLAUDE.md`, `README.md` and `docs/` resolves.

## Boundaries

- **Always:** take dates and alternatives from the source specs; supersede rather than rewrite reversed decisions; change only comment text in code files.
- **Ask first:** adding an ADR that isn't on the approved shortlist; creating an issue for a follow-up whose status is unclear.
- **Never:** invent rationale or alternatives the specs don't record; change runtime behavior; delete `specs/` before the archive tag exists on the remote.

## Success Criteria

1. `docs/decisions/` holds the approved ADRs plus an index, each in the template with an honest date, status and provenance.
2. Zero references to `specs/` remain in code, CI, or docs. The one exception is the ADR source lines, which cite the archive by tag, e.g. `specs/02-pwa-client/SPEC.md §2 #7 @ specs-archive`.
3. `specs/` is deleted, and the `specs-archive` tag on origin points at a commit that still contains it.
4. Each still-open follow-up is a GitHub issue, and each resolved one is noted as such in the PR description.
5. Typecheck, core tests and the sync.py tests pass.
6. `CLAUDE.md` no longer describes `specs/` as a frozen archive; it says ADRs hold the history.

## Resolved (Scott, 2026-10-25)

- Keep all 27 ADRs.
- Delete `specs/`, keeping the `specs-archive` tag.
- Fold this work into PR #9 (branch `worktree-agent-skills-guidance`).

## Follow-ups → Issues

- **Slim `get_daily_summary`** (~120K characters): still open per the epic 6 notes, so it becomes an issue.
- **Ghost GitHub Actions runs:** no issue, since only GitHub support can act on them.

## Open Questions

1. **Epic 5 phase 3 leftovers** (the `FDC_API_KEY` secret on the `apps/web` worker, the on-phone scan smoke test, continued catalog seeding): are any still open? Until Scott answers, no issue is created; the build does not block on this.
2. **`apps/mcp-server/src/prompts.ts:100`** (found during build). The `log_meal_conversation` prompt text, which is sent to Claude at runtime, says `(specs/05-nutrition-accuracy/SPEC.md, phase 1 protocol)`. Claude can't open that path from a conversation, so the reference is dead either way. But editing it changes runtime prompt content, which the boundaries say to ask about first. It's left unchanged until Scott decides; the proposed edit is to drop the parenthetical.
