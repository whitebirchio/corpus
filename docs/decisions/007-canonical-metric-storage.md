# ADR-007: Canonical metric storage; the server does all unit conversion

## Status
Accepted

## Date
2026-07-01

## Context
Inputs arrive in whatever units the speaker uses: lbs, miles, "6 oz", min/mile paces. Unit errors are the classic source of silent corruption in health data, and LLMs are unreliable at arithmetic. Scott's display preference is imperial.

## Decision
- **Store canonical metric units:** kg for mass and load, meters for distance, seconds for duration, kcal for energy. Paces are s/km.
- **Tools accept unit-tagged `{ value, unit }` pairs, and the server converts** (`core/units.ts`). The LLM never does unit math, and conversion never happens in a tool handler.
- Display preference lives on `users`.
- Timestamps are stored in UTC. Each user's `timezone` derives the `local_date` that daily records key on.

## Alternatives Considered

### Store values in the units they were entered in
- Not recorded as a considered option in the specs. Rejected implicitly by the corruption risk: comparisons and trends would need per-row unit math.

## Consequences
- Every write echoes back the stored values, so a conversion error is visible immediately.
- The rule extends to every later domain:
  - **Training plans** (2026-07-05): target loads in kg, distances in m, paces in s/km, so planned-vs-actual comparison never involves LLM unit math (ADR-022).
  - **Nutrition** (2026-07-18): catalog foods carry a portion→gram map, so the server does the portion→gram→macro math as well (ADR-025).

---
Backfilled 2026-10-25 from specs/01-initial-platform/SPEC.md §1 #4, §5, §11 #4; specs/04-training-plans/SPEC.md §2 #10; specs/05-nutrition-accuracy/SPEC.md §2 #1 @ specs-archive.
