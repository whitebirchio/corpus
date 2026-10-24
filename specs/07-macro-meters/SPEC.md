# Epic 7 — Macro meters: calorie bar + status colors

**Status:** designed 2026-10-24, not built. Small PWA-only presentation change; no core, schema, or MCP surface changes.

## 1. Objective

The Today view's Nutrition card (`apps/web/src/views/Today.tsx`) shows calories as a hero number with a "of X kcal target · N left/over" caption, and protein/carbs/fat as `Meter` bars that are always blue (`--series-1`) and clamp at 100%. A bar therefore can't tell you that you're close to, or past, the day's limit.

This epic makes the card answer "how much room do I have left today?" at a glance:

1. **A calorie progress bar** directly under the hero number.
2. **Status colors on every bar** (calories, protein, carbs, fat): neutral while comfortably under, a warning color when close to the target, and a distinct "exceeded" color once over.

**Semantics decision:** all four targets are treated as a **max** — including protein. (Considered and rejected for now: protein as a floor that turns green on reaching target; per-macro floor/max flags on `nutrition_targets`.)

### Acceptance criteria

- **AC1 — calorie bar.** When the day has targets, a full-width calorie bar renders directly below the hero kcal number + caption and above the protein meter. The hero number and its "N left / N over" caption remain unchanged.
- **AC2 — status rule.** Each bar's status is computed from the raw (unrounded) ratio `value / target`:

  | Status  | Ratio             | Fill color                   |
  |---------|-------------------|------------------------------|
  | `under` | `< 0.90`          | `--series-1` (existing blue) |
  | `near`  | `0.90 ≤ r ≤ 1.00` | `--warn` (new amber token)   |
  | `over`  | `> 1.00`          | `--danger` (existing red)    |

  Landing exactly on target is `near`, not `over`.
- **AC3 — one threshold.** The 0.90 warning ratio lives in exactly one constant (`WARN_RATIO`); calories and macros share it.
- **AC4 — fill width.** Fill width still clamps at 100%; `over` is conveyed by color, not by overflowing the track.
- **AC5 — not color alone (WCAG 1.4.1).** In the `over` state each macro meter's numbers line also says how far over, e.g. `182 g / 160 g · 22 g over`. The calorie bar relies on the existing hero caption ("N over"), which sits directly above it.
- **AC6 — no target.** If `day.targets` is null, or a target is ≤ 0, no bar renders for that metric (today's behavior).
- **AC7 — themes.** `--warn` is defined for light and dark mode alongside `--danger`. Every fill color has ≥ 3:1 contrast against the track `--series-1-track` (WCAG 1.4.11).
- **AC8 — any day.** Past days reached via the ‹ › date nav use the same rule (status is purely a function of that day's totals vs. that day's targets).

### Out of scope

Per-macro floor/max configuration; any `nutrition_targets` schema or MCP tool change; a fiber meter; the Trends view; the MCP `get_daily_summary` text; the Scan view.

## 2. Tech stack

Existing `apps/web` stack only: React 19, plain CSS custom properties in `src/styles.css`, Vitest. **No new dependencies.**

## 3. Commands

```sh
npm run typecheck && npm test        # whole workspace — mirrors CI; run before committing
npm test -w corpus-web               # web vitest only
npm run dev:web                      # vite build + wrangler dev on :8788 (needs apps/web/.dev.vars)
npm run dev:ui -w corpus-web         # Vite HMR on :5173, proxying /api to :8788 — visual check
```

## 4. Project structure

| File | Change |
|---|---|
| `apps/web/src/format.ts` | Add pure `meterStatus(value, target): "under" \| "near" \| "over" \| null` and `WARN_RATIO = 0.9` (null when target is null or ≤ 0). |
| `apps/web/src/views/Today.tsx` | `Meter` computes status via `meterStatus`, sets it as a class on `.fill`, and appends the over-text. The calorie bar reuses the same track/fill markup as a bare track (no head row) under the hero, since the hero already shows the numbers. Reuse `fmtInt`, `fmtGrams`, `remainingLabel`. |
| `apps/web/src/styles.css` | Add `--warn` in `:root` and the dark-mode block next to `--danger`; add `.meter .fill.near` / `.meter .fill.over` rules. Track color unchanged. |
| `apps/web/test/meter.test.ts` | Unit tests for `meterStatus`. |

`packages/core` is untouched: this is presentation over targets the REST API already returns, so the "logic belongs in core" rule doesn't apply (no second consumer needs it).

## 5. Code style

Match the existing `Meter`: small function components in the same file, class-based styling through CSS tokens, no inline colors in TSX.

```tsx
const status = meterStatus(value, target);
// …
<div className={`fill ${status}`} style={{ width: `${pct}%` }} />
```

```css
:root      { --warn: #a86a00; } /* amber — 3.36:1 vs --series-1-track */
/* dark */ { --warn: #e8a33a; } /* 5.54:1 vs dark track */

.meter .fill.near { background: var(--warn); }
.meter .fill.over { background: var(--danger); }
```

Measured contrast vs. track: light blue 3.34, light red 3.63, dark red 3.70 — all pass 3:1. (The first-draft amber `#d68a00` measured 2.12 and was rejected.) Amber and red are close in luminance in light mode, so they're distinguished mainly by hue — which is why AC5's text cue is required, not optional.

## 6. Testing strategy

- **Unit (Vitest, `apps/web/test/meter.test.ts`):** `meterStatus` boundaries — `0`, ratio `0.899`, `0.9`, `1.0`, `1.0001`, target `null`, target `0`.
- **Manual visual check** via `dev:ui` in light and dark mode on three days: under (< 90%), near (90–100%), over (> 100%) — confirm colors, clamped width, and the over-text.
- No core/PGlite tests needed (core unchanged).

## 7. Boundaries

- **Always:** keep the threshold in one constant; colors as tokens only; run `npm run typecheck && npm test` before committing.
- **Ask first:** changing the 0.90 ratio; making protein (or any macro) a floor; any schema, REST, or MCP change.
- **Never:** hard-coded hex in TSX; removing the hero number or caption; color as the only signal of "over".

## 8. Success criteria

AC1–AC8 hold, verified by the unit tests and the light/dark visual check, with `npm run typecheck && npm test` green.

## 9. Open questions

- **Amber hues** — `#a86a00` (light) / `#e8a33a` (dark) are proposals that pass contrast; swap in review if you'd prefer a different tone.
