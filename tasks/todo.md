# Todo: Migrate the `specs/` archive into agent-skills artifacts

Plan: [tasks/plan.md](plan.md) · Spec: [SPEC.md](../SPEC.md)

**Citation rule (Tasks 8–20):** rationale citation → `ADR-NNN`. Structural citation → remove it, or state the fact inline. Change comment text only.
**ADR rule (Tasks 2–7):** use the `documentation-and-adrs` template (Status, Date, Context, Decision, Alternatives Considered, Consequences) plus `Backfilled 2026-10-25 from specs/… §… @ specs-archive`. Content comes from the source spec only.

---

## Task 1: Tag and push `specs-archive` ✅

**Description:** Create an annotated tag `specs-archive` on `0f1a080` (origin/main, which contains `specs/01–07`) and push it.

**Acceptance criteria:**
- [x] `git ls-remote origin "refs/tags/specs-archive^{}"` returns `0f1a080…` (done 2026-10-25; tag object `347e05f`)
- [x] `git ls-tree -r --name-only specs-archive specs/` lists all 7 epic specs (13 files, including the IMPLEMENTATION/FOLLOWUPS notes)

**Verification:** both commands above · **Dependencies:** None · **Files:** none · **Scope:** XS

---

## Task 2: ADRs 001–005 ✅

**Description:** 001 agent-first MCP surface (01 §1 #3, §2 #1) · 002 no web UI in v1, *Superseded by ADR-016* (01 §2 #2) · 003 Cloudflare + Neon + R2 under <$5/mo (01 §1 #2, §2 #9, §4) · 004 hexagonal core + ports (01 §1 #7, 02 §2 #5, 05 §2 #8) · 005 MCP OAuth 2.1 + DCR, Google upstream, allowlist (01 §2 #10, §7). All dated 2026-07-01.

**Acceptance criteria:**
- [ ] 5 files in `docs/decisions/`, each with all template sections and a provenance line
- [ ] Alternatives match those recorded in the source spec

**Verification:** `grep -c "^## " docs/decisions/00[1-5]-*.md` shows 6 each; read against the sources · **Dependencies:** None · **Files:** 5 new · **Scope:** S

---

## Task 3: ADRs 006–010 ✅

**Description:** 006 Postgres RLS + denormalized `user_id` + SELECT-only `query_data` (01 §1 #5, §7) · 007 canonical metric storage (01 §1 #4, §11 #4; 04 §2 #10) · 008 three-tier dedup (01 §5.9) · 009 keep originals in R2 (01 §1 #6, §2 #4) · 010 record granularity (01 §2 #5–6). All 2026-07-01.

**Acceptance criteria:** same as Task 2 · **Verification:** same · **Dependencies:** None · **Files:** 5 new · **Scope:** S

---

## Task 4: ADRs 011–015 ✅

**Description:** 011 regimen + exceptions (01 §2 #7) · 012 fresh start + baselines (01 §1 #8, §2 #3) · 013 manual Garmin export imports, 2026-07-01, *Superseded by ADR-014* · 014 nightly unofficial-API Garmin pull in GitHub Actions, the Python job only forwards, mapping in core (01 §2 #8, §8.4, §11 #8; 06 §2 #1), 2026-07-02 · 015 drop MacroFactor import (01 §2 #8b), 2026-07-02.

**Acceptance criteria:** as in Task 2, plus 013 ↔ 014 cross-reference each other · **Verification:** same · **Dependencies:** None · **Files:** 5 new · **Scope:** S

---

## Task 5: ADRs 016–020 ✅

**Description:** 016 PWA not native, complementary and never PWA-only, supersedes 002 (02 §2 #1–2, #10; 05 §2 #7), 2026-07-02 · 017 `apps/web` worker: Hono + Vite/React, same origin (02 §2 #3–4, #12, #14; FOLLOWUPS #1, #3, #9) · 018 rolling signed-cookie session + Lax/header CSRF (02 §2 #6–8, #15; FOLLOWUPS #6–7) · 019 imported records immutable (02 §2 #11; 03 §2 #1), 2026-07-03 · 020 structured status unions (03 §2 #4), 2026-07-03.

**Acceptance criteria:** as in Task 2; 016 and 002 cross-reference · **Verification:** same · **Dependencies:** Task 2 (002 exists) · **Files:** 5 new · **Scope:** S

---

## Task 6: ADRs 021–024 ✅

**Description:** 021 Claude is the planning brain (04 §2 #1) · 022 `planned_*` tables, one plan per week, uniform prescriptions, upcoming-only re-plan, and milestones/capability estimates as consequences (04 §2 #2–5, #11–12) · 023 agent-mediated linking + in-transaction `plan_changes`, athlete model (04 §2 #6–9) · 024 must-have context as tools, not resources (04 §2 #13). All 2026-07-05.

**Acceptance criteria:** as in Task 2 · **Verification:** same · **Dependencies:** None · **Files:** 4 new · **Scope:** S

---

## Task 7: ADRs 025–027 + index ✅

**Description:** 025 food catalog + FDC/OFF, agent-confirmed, never blocks a log (05 §2 #1, #3–6), 2026-07-18 · 026 Garmin is the weigh-in source of truth, window-scoped deletes, live-data traps (06 §2 #2–9 + IMPLEMENTATION live-data notes), 2026-10-23 · 027 all nutrition targets are maxima (07 §1), 2026-10-24. `docs/decisions/README.md`: a table of number, title, status, date.

**Acceptance criteria:**
- [ ] As in Task 2
- [ ] The index lists all 27 with correct statuses (002 and 013 Superseded)

**Verification:** `ls docs/decisions | wc -l` = 28; every index link resolves · **Dependencies:** Tasks 2–6 · **Files:** 4 new · **Scope:** S

---

## Checkpoint A: ADRs complete
- [x] 27 ADRs + index; each Superseded-by target exists
- [x] Human review of the ADR set (skipped: running `/build auto`)

---

## Tasks 8–19: Citation passes

Each task applies the citation rule to its files.

**Acceptance criteria (each):**
- [ ] `grep -nE "specs/|SPEC" <files>` returns nothing
- [ ] Every `ADR-NNN` introduced exists in `docs/decisions/`
- [ ] The diff touches comment lines only

**Verification (each):** `npm run typecheck`; plus `npx vitest run` (in `packages/core`) for core tasks, `npm test -w corpus-web` for web tasks, and `python -m py_compile` + `python -m pytest apps/garmin-sync` for Task 14.
**Dependencies (each):** Task 7.

- [x] **Task 8:** `packages/core/src/db/schema.ts` (14 cites) · S
- [x] **Task 9:** `packages/core/src/schemas/{inputs,foods,labs,training,trends}.ts` · S
- [x] **Task 10:** `packages/core/src/repos/{meals,foods,recipes,trends,summary}.ts` · S
- [x] **Task 11:** `packages/core/src/repos/{workouts,movements,training,athlete,regimen}.ts` · S
- [x] **Task 12:** `packages/core/src/repos/{labs,checkins,users}.ts`, `src/labs/analytes.ts`, `src/import/garmin.ts` · S
- [x] **Task 13:** `packages/core/src/nutrition/{fdc,off,types}.ts`, `src/time.ts`, `src/units.ts` · S
- [x] **Task 14:** `packages/core/test/{garmin-import,meals-catalog}.test.ts`, `apps/garmin-sync/{sync,test_sync}.py`, `.github/workflows/garmin-sync.yml` · S
- [ ] **Task 15:** `apps/mcp-server/src/{tools,prompts,mcp,schemaDoc,profile}.ts` · S
- [ ] **Task 16:** `apps/mcp-server/src/{auth/google,db,garmin,upload,nutrition,trainingProfile}.ts`, `wrangler.jsonc` · S (7 files, one-line edits each)
- [ ] **Task 17:** `apps/web/worker/{api,auth,session,db,index}.ts` (api.ts has 14 cites) · S
- [ ] **Task 18:** `apps/web/worker/{nutrition,env.d}.ts`, `apps/web/{wrangler.jsonc,vite.config.ts}`, `apps/web/src/styles.css` · S
- [ ] **Task 19:** `apps/web/src/api.ts`, `src/views/{Today,Plan,Scan,Trends}.tsx`, `src/components/PlannedSession.tsx` · S

---

## Checkpoint B: code clean
- [ ] `npm run typecheck && npm test` pass
- [ ] `python -m pytest apps/garmin-sync` passes
- [ ] `grep -rnE "specs/|SPEC" apps packages .github --exclude-dir=node_modules` is empty

---

## Task 20: Top-level docs point to ADRs

**Description:** `CLAUDE.md`: replace the "frozen archive" paragraph with "the history lives in ADRs (`docs/decisions/`); the old epic specs are under the `specs-archive` tag", and re-point the `§5.9` and "epic 2" mentions. `README.md`: replace the `specs/` and `specs/01` links. `docs/SETUP.md`: three references (lines ~141, ~216).

**Acceptance criteria:**
- [ ] No `specs/` references in these files except mentions of the `specs-archive` tag
- [ ] Every relative link resolves

**Verification:** grep + `ls` each link target · **Dependencies:** Task 7 · **Files:** 3 · **Scope:** S

---

## Task 21: Issue — slim `get_daily_summary`

**Description:** `gh issue create` from the epic 6 follow-up: ~120K characters per call (insights ≈57K, goals ≈37K); slim to digests with on-demand detail.

**Acceptance criteria:** [ ] the issue exists and is linked from the PR #9 description · **Verification:** `gh issue list` · **Dependencies:** None · **Scope:** XS

---

## Task 22: Delete `specs/` and run the final sweep

**Description:** Confirm the tag is on origin, then `git rm -r specs/`. Run the full sweep. Update the `corpus-project-overview` and `agent-skills-pure-workflow` memories (specs deleted, ADRs hold the history). Update the PR #9 title and description.

**Acceptance criteria:**
- [ ] `specs/` is gone; `git ls-remote --tags origin specs-archive` is non-empty
- [ ] `grep -rnE "specs/" . --exclude-dir={node_modules,.git,docs/decisions}` returns nothing outside `SPEC.md`/`tasks/` (which describe this migration)
- [ ] All SPEC success criteria are checked

**Verification:** Checkpoint B commands again · **Dependencies:** Tasks 1, 8–21 · **Scope:** S

---

## Checkpoint C: complete
- [ ] SPEC success criteria 1–6 met
- [ ] PR #9 updated and ready for review
