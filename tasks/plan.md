# Implementation Plan: Macro meters (epic 7)

Spec: [`specs/07-macro-meters/SPEC.md`](../specs/07-macro-meters/SPEC.md). Task checklist: [`tasks/todo.md`](todo.md).

## Overview

The Today view's Nutrition card gets a calorie progress bar under the hero kcal number, and all four bars (calories, protein, carbs, fat) get status colors. A bar is blue below 90% of the day's target, amber from 90% to 100% inclusive, and red when over. Every target is treated as a max. The change is PWA-only presentation (`apps/web`); core, schema, REST, and MCP don't change.

## Architecture decisions

- **Status lives in one pure function.** `meterStatus(value, target)` and `WARN_RATIO = 0.9` go in `apps/web/src/format.ts`, next to the other display helpers. It returns `null` when there's no usable target (null or ≤ 0), which doubles as the "render no bar" signal (AC6). The function isn't in core because no second consumer needs it, and the MCP side stays text-only.
- **Color is a CSS class, never inline.** The `.fill` element gets `under`/`near`/`over` as a class, and `styles.css` maps `near` → `--warn` (new) and `over` → `--danger` (existing). `under` keeps the base `.fill` rule (`--series-1`), so the default look is unchanged.
- **One track/fill markup for all four bars.** The calorie bar reuses the `.meter .track/.fill` markup without the head row, because the hero number and caption already show its numbers and the "N over" text (AC5). We pull out a small `MeterBar` component that both `Meter` and the calorie bar render. That avoids a second copy of the clamp and status logic.
- **Tokens:** light `--warn: #a86a00` (3.36:1 against the track), dark `--warn: #e8a33a` (5.54:1). The spec measured both. Amber and red are close in luminance in light mode, which is why the over-text in AC5 is required.

## Dependency graph

```
meterStatus + WARN_RATIO (format.ts)  ── Task 1 (with unit tests)
    ├── macro meters colored + --warn token   ── Task 1
    │     └── macro over-text ("N g over")     ── Task 2
    └── calorie bar under hero (MeterBar)      ── Task 3
                                                   └── docs close-out ── Task 4
```

Tasks 2 and 3 both depend only on Task 1, but they edit the same component in `Today.tsx`, so they run one after the other, not in parallel.

## Task list

### Phase 1: Status colors on the existing macro meters
- [x] Task 1: `meterStatus` + tests + colored protein/carbs/fat fills
- [x] Task 2: "N g over" text on over-target macro meters

### Checkpoint: Macro meters
- [x] `npm run typecheck && npm test` green
- [x] Visual: protein/carbs/fat show blue, amber, and red on suitable days in light and dark mode

### Phase 2: Calorie bar
- [x] Task 3: Calorie bar under the hero number, sharing `MeterBar`

### Checkpoint: Feature complete
- [x] `npm run typecheck && npm test` green
- [x] Visual check of all four bars, light and dark, on under/near/over days (spec §6)
- [x] Scott reviews before docs close-out (confirmed live 2026-10-24; amber kept)

### Phase 3: Close-out
- [x] Task 4: Mark epic 7 built in spec + README

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Light-mode amber vs. red are close in luminance and hard to tell apart at a glance | Med | Over-text (Task 2) and the hero caption carry "over" in words. Scott can adjust the hue in review (spec §9). |
| Floating-point edge at exactly 100% (e.g. summed meal macros 160.0000001 g vs a 160 g target) shows red when the display says "160g / 160g" | Low | The spec says to use the raw ratio (AC2). A unit test pins the behavior, and Task 2's over-text (rounded) would read "0 g over". The task hides the over-text when the rounded overage is 0, so the display never claims "0 g over". |
| `apps/web` tests are typechecked under `tsconfig.node.json` (`include: ["test", …]`), and importing `src/format.ts` from `test/` might pull DOM-lib assumptions | Low | `format.ts` uses only `Intl`/`Date`. If typecheck complains, add the file to that config's `include`, as `worker/session.ts` already is. |
| No real "near" or "over" day in prod data for the visual check | Low | Use `dev:ui` against a Neon dev branch and log a test meal, or pick past days with ‹ ›. |

## Open questions

- Amber hues (spec §9). Current proposals pass contrast. Scott can swap them in review at the Phase 2 checkpoint.
