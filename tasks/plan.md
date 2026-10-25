# Implementation Plan: Migrate the `specs/` archive into agent-skills artifacts

Spec: [`SPEC.md`](../SPEC.md). Task checklist: [`tasks/todo.md`](todo.md). Lands on PR #9 (branch `worktree-agent-skills-guidance`).

## Overview

Backfill 27 ADRs from the epic 1–7 specs. Then re-point or remove every `specs/` / `SPEC §` citation in 60 files (code, config, CI, docs). Open an issue for the one still-open follow-up, tag the archive, and delete `specs/`. Runtime behavior does not change.

## Dependency graph

```
specs-archive tag (Task 1) ──────────────────────────────┐
ADRs 001–027 + index (Tasks 2–7) ──┬── citation passes (Tasks 8–20) ──┤
                                   └── CLAUDE.md / README / SETUP (Task 20)
                                                                       └── delete specs/ + final sweep (Task 22)
get_daily_summary issue (Task 21) — independent
```

Citation passes need the ADR numbers to exist, so they can cite `ADR-NNN` and the check "every cited ADR exists" holds. Deleting `specs/` comes last, and only after the tag is on origin.

## Architecture decisions

- **One citation rule, applied consistently.** A *rationale* citation becomes `ADR-NNN`. A *structural* citation ("per §6.1", "§5.6 lab schema") is removed, or turned into a brief inline statement when the comment would lose meaning without it. Only comment text changes.
- **ADR files:** `docs/decisions/NNN-kebab-title.md`, heading `# ADR-NNN: Title`, using the `documentation-and-adrs` template. Each ends with a provenance line citing `… @ specs-archive`.
- **Tag first:** `specs-archive` → `0f1a080` (origin/main, contains `specs/01–07`), pushed before anything is deleted.
- **Task size:** citation passes group up to about 5 files by area. Each edit is a comment of one or two lines, so tasks stay XS–S even at 5 files.

## Task list

### Phase 1: Foundation
- [x] Task 1: Tag and push `specs-archive` — done 2026-10-25

### Phase 2: ADRs (in decision order)
- [ ] Task 2: ADRs 001–005 (platform: agent-first, no UI v1, hosting, hexagonal core, MCP auth)
- [ ] Task 3: ADRs 006–010 (RLS, canonical units, dedup tiers, keep originals, granularity)
- [ ] Task 4: ADRs 011–015 (regimen, fresh start, manual Garmin exports → superseded, nightly Garmin sync, drop MacroFactor)
- [ ] Task 5: ADRs 016–020 (PWA, apps/web worker, session/CSRF, imports immutable, status unions)
- [ ] Task 6: ADRs 021–024 (planning brain, plan tables, linking + plan_changes, tools over resources)
- [ ] Task 7: ADRs 025–027 + `docs/decisions/README.md` index

### Checkpoint A: ADRs complete
- [ ] 27 files plus the index; template sections, provenance line, and Superseded links all valid
- [ ] Human review of the ADR set before the citation passes

### Phase 3: Citation passes
- [ ] Task 8: core: `db/schema.ts`
- [ ] Task 9: core: `schemas/*` (inputs, foods, labs, training, trends)
- [ ] Task 10: core: `repos/` meals, foods, recipes, trends, summary
- [ ] Task 11: core: `repos/` workouts, movements, training, athlete, regimen
- [ ] Task 12: core: `repos/` labs, checkins, users + `labs/analytes.ts`, `import/garmin.ts`
- [ ] Task 13: core: `nutrition/*`, `time.ts`, `units.ts`
- [ ] Task 14: core tests (2 files) + `apps/garmin-sync` (sync.py, test_sync.py) + `.github/workflows/garmin-sync.yml`
- [ ] Task 15: mcp-server: `tools.ts`, `prompts.ts`, `mcp.ts`, `schemaDoc.ts`, `profile.ts`
- [ ] Task 16: mcp-server: `auth/google.ts`, `db.ts`, `garmin.ts`, `upload.ts`, `nutrition.ts`, `trainingProfile.ts`, `wrangler.jsonc`
- [ ] Task 17: web worker: `api.ts`, `auth.ts`, `session.ts`, `db.ts`, `index.ts`
- [ ] Task 18: web worker + config: `nutrition.ts`, `env.d.ts`, `wrangler.jsonc`, `vite.config.ts`, `styles.css`
- [ ] Task 19: web SPA: `api.ts`, views (Today, Plan, Scan, Trends), `PlannedSession.tsx`

### Checkpoint B: code clean
- [ ] `npm run typecheck && npm test` pass; `python -m py_compile` + sync.py tests pass
- [ ] No `specs/` or `SPEC §` left under `apps/`, `packages/` or `.github/`

### Phase 4: Docs, issue, retire
- [ ] Task 20: `CLAUDE.md`, `README.md`, `docs/SETUP.md` point to ADRs; drop the "frozen archive" wording
- [ ] Task 21: GitHub issue: slim `get_daily_summary`
- [ ] Task 22: Delete `specs/`, run the final sweep, update memory and the PR #9 description

### Checkpoint C: complete
- [ ] All SPEC success criteria met; PR #9 ready for review

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A backfilled ADR states rationale the specs never recorded | Med: rewrites history | Write each ADR from the source spec only; the provenance line makes it auditable |
| Deleting a structural citation loses context a reader needed | Low | Replace it with a short inline fact when the comment reads badly without it |
| A comment edit accidentally touches code | Med | Comment-only diffs; typecheck + tests at Checkpoint B; review `git diff --stat` per task |
| The tag isn't on the remote when `specs/` is deleted | High: the archive is only in reflog/PR history | Task 22 checks `git ls-remote --tags origin specs-archive` first |
| Ambiguous bare `SPEC §N` (which epic?) | Low | Resolve by the file's area (`apps/web` → 02, training files → 04, …) and read the cited section to confirm |

## Open questions

- Epic 5 phase 3 leftovers (see SPEC): no issue until Scott confirms whether they're still open.
