# Todo: Macro meters (epic 7)

Plan: [`tasks/plan.md`](plan.md). Spec: [`specs/07-macro-meters/SPEC.md`](../specs/07-macro-meters/SPEC.md).

## Phase 1: Status colors on the existing macro meters

### Task 1: `meterStatus` + tests + colored protein/carbs/fat fills

**Description:** Add the pure status function and the single threshold constant. Wire it into the existing `Meter` so the protein, carbs and fat fills turn amber at ≥ 90% of target and red above 100%, using a new `--warn` token plus the existing `--danger`.

**Acceptance criteria:**
- [x] `meterStatus(value, target)` in `apps/web/src/format.ts` returns `"under"` below 0.9, `"near"` for 0.9 ≤ r ≤ 1.0, `"over"` above 1.0, and `null` when the target is null or ≤ 0. `WARN_RATIO = 0.9` is exported and is the only place the threshold lives (AC2, AC3).
- [x] `Meter`'s `.fill` gets the status as a class. `styles.css` defines `--warn` in light (`#a86a00`) and dark (`#e8a33a`) next to `--danger`, plus `.meter .fill.near` and `.meter .fill.over` rules. There's no hex in TSX, and fill width still clamps at 100% (AC4, AC7).
- [x] Meters with no target or a target ≤ 0 still render without a track (AC6).

**Verification:**
- [x] Tests pass: `npm test -w corpus-web`. The new `apps/web/test/meter.test.ts` covers 0, 0.899, 0.9, 1.0, 1.0001, a null target, and a 0 target.
- [x] Build succeeds: `npm run typecheck`
- [ ] Manual check: `npm run dev:ui -w corpus-web`. A macro over 90% is amber and one over 100% is red, in light and dark mode.

**Dependencies:** None

**Files likely touched:**
- `apps/web/src/format.ts`
- `apps/web/src/views/Today.tsx`
- `apps/web/src/styles.css`
- `apps/web/test/meter.test.ts`

**Estimated scope:** Medium (4 files)

### Task 2: "N g over" text on over-target macro meters

**Description:** When a macro meter is `over`, its numbers line adds how far over it is (e.g. `182g / 160g · 22g over`), so "over" isn't conveyed by color alone.

**Acceptance criteria:**
- [ ] For `over` meters, the numbers line reads `<value> / <target> · <diff> over`, formatted with `fmtGrams` (AC5).
- [ ] The suffix is hidden when the rounded overage is 0 (float edge), and it never appears for `under` or `near`.

**Verification:**
- [ ] Tests pass: `npm test -w corpus-web`
- [ ] Build succeeds: `npm run typecheck`
- [ ] Manual check: on an over day, the red macro shows the over-text and the others don't.

**Dependencies:** Task 1

**Files likely touched:**
- `apps/web/src/views/Today.tsx`
- `apps/web/src/styles.css` (only if the suffix needs styling)

**Estimated scope:** Small (1–2 files)

## Checkpoint: Macro meters
- [ ] `npm run typecheck && npm test` green
- [ ] Visual: protein/carbs/fat show blue, amber, and red on suitable days in light and dark mode

## Phase 2: Calorie bar

### Task 3: Calorie bar under the hero number, sharing `MeterBar`

**Description:** Pull the track and fill markup out of `Meter` into a `MeterBar({ value, target })` component. `Meter` keeps its head row and renders `MeterBar`, and a bare `MeterBar` for calories renders directly under the hero caption, above Protein, with the same status colors.

**Acceptance criteria:**
- [ ] When `day.targets` exists, a full-width calorie bar renders between the hero caption and the Protein meter. The hero number and its "N left / N over" caption are unchanged (AC1).
- [ ] The calorie bar follows the same under/near/over rule through `meterStatus` and clamps at 100% (AC2, AC4).
- [ ] There's no calorie bar when targets are null or the calorie target is ≤ 0 (AC6), and past days via ‹ › follow the same rule (AC8).

**Verification:**
- [ ] Tests pass: `npm test -w corpus-web`
- [ ] Build succeeds: `npm run typecheck`
- [ ] Manual check: `dev:ui`, with the calorie bar at under, near, and over in light and dark mode, and spacing that matches the macro meters.

**Dependencies:** Task 1

**Files likely touched:**
- `apps/web/src/views/Today.tsx`
- `apps/web/src/styles.css` (spacing for the bare bar under the hero)

**Estimated scope:** Small (2 files)

## Checkpoint: Feature complete
- [ ] `npm run typecheck && npm test` green (whole workspace, mirrors CI)
- [ ] Visual check of all four bars, light and dark, on under/near/over days (spec §6)
- [ ] Scott reviews, including the amber hue (spec §9), before close-out

## Phase 3: Close-out

### Task 4: Mark epic 7 built in spec + README

**Description:** Update the spec status line and the `specs/README.md` epic 7 entry from "designed, not built" to built, noting any deviations from the spec, such as a changed hue.

**Acceptance criteria:**
- [ ] The `specs/07-macro-meters/SPEC.md` status line and the `specs/README.md` entry both say built (with the date), and any deviations are recorded.

**Verification:**
- [ ] Manual check: the README link resolves, and the status reads correctly.

**Dependencies:** Task 3 and the Feature-complete checkpoint

**Files likely touched:**
- `specs/07-macro-meters/SPEC.md`
- `specs/README.md`

**Estimated scope:** XS (2 doc files)
