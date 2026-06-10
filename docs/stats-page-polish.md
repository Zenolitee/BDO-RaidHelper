# Stats page polish

Date: 2026-06-07

## What was wrong
On `/stats` the card titles were inconsistent:
- Some cards rendered an `eyebrow` *and* a heading *and* the cyan `card-titlebar` pill produced by `wrapTerminal()`, so titles were stacked, clipped, or duplicated.
- The "War output mix" card (`.score-mix-card`) had a fixed `132px` first grid column with `align-items: center`, which pushed the donut and label away from the card's natural left padding and made the layout look like it had extra left padding.
- The "Scoreboard totals" eyebrow text on the scoreboard-totals panel was redundant with the visible tab button ("▸ Scoreboard totals") and added visual noise.

## What changed

### 1. `src/styles/input.css` (line ~360) — hide the original header in terminal cards
Added a rule that hides any direct `<header>` child of an `.is-terminal` card unless it is the JS-inserted `card-titlebar`:

```css
.is-terminal > header:not(.card-titlebar) { display: none !important; }
```

This is the single source of truth for the fix. It applies to every card listed in `CARD_TERMINAL_SELECTOR` (`.event-card`, `.server-card`, `.score-table-panel`, `.score-mix-card`, `.score-leader-card`, `.score-trend-card`, `.stats-upload-panel`, `.stats-analysis-panel`, `.report-card`, `.day-card`, `.impact-panel`, `.terminal-card`, etc.) so future terminal cards automatically get the same treatment.

### 2. `src/styles/input.css` (line ~2031) — War output mix grid
Changed the `.score-mix-card` grid so the donut sits at the card's natural left padding:

```css
.score-mix-card {
  grid-template-columns: auto minmax(0, 1fr); /* was 132px minmax(0,1fr) */
  align-items: start;                        /* was center */
  column-gap: 18px;
  row-gap: 12px;
}
```

`align-items: start` keeps the donut and the leader list top-aligned without the donut being vertically centered inside the card body.

### 3. `src/web.ts` (line ~2491) — remove redundant eyebrow
Dropped the `<p class="eyebrow">Scoreboard totals</p>` from the scoreboard-totals panel header. The header now reads:

```html
<header><h3>Raw stats</h3><small>Sort each column …</small></header>
```

`deriveTitle()` falls through to the `<h3>`, so the `card-titlebar` pill now shows **"Raw stats"** instead of duplicating the tab label.

## Verification
- `npm run build:css` → success (245 ms).
- `npm run typecheck` → clean (no errors).
- Compiled `src/public/styles.css` confirmed to contain:
  - `.is-terminal>header:not(.card-titlebar){display:none!important}`
  - `.score-mix-card{grid-column:span 2;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:12px 18px}`
- `src/web.ts` confirmed to no longer contain the standalone "Scoreboard totals" `<p class="eyebrow">…</p>` line; only the tab button still references that string.

## Files touched
- `src/styles/input.css` — added `.is-terminal > header:not(.card-titlebar)` rule; updated `.score-mix-card` grid.
- `src/public/styles.css` — rebuilt automatically by `npm run build:css`.
- `src/web.ts` — removed redundant eyebrow from the scoreboard-totals panel header.

## Out of scope (intentionally not changed)
- The "Impact formula" panel still uses the eyebrow + h3 pattern. The user request only mentioned the "Scoreboard totals" duplication, and changing that panel would also change the visible titlebar text (it would become "Impact ranking" instead of "Impact formula"), so it is left as-is.
- The JS in `wrapTerminal()` / `deriveTitle()` was not modified; the CSS-level fix keeps it as the single source of truth.
