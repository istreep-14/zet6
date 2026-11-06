# UI Improvement Phase — roadmap from the mockup sandboxes

Mapping of the mockup HTML concepts (grand-architecture + mobile-UX archetype sandboxes)
onto the real app. The step wizard from the first sandbox was tried and removed by
request; the phase now follows the mobile archetype sandbox's best-fit features.

## ✅ Applied

- **Archetype 4 — Picture-in-Picture HUD.** Floating strip above the tab bar on the
  Staff and Cash tabs showing live Rate / Pool / Chump from the same vm every render;
  red border + "bills short" when the distribution can't pay out; tap → Summary.
  Hidden on Summary (redundant) and on a pristine session; drops to the screen bottom
  when the keyboard hides the tab bar. (`index.html`, `css/tabs.css`,
  `src/render/tabs.js`)
- **Archetype 10 — Actionable sieve prompts.** The Summary warn box now embeds the
  same "Break Bills → Small Change" trade card the dist modal computes (Apply works —
  `pendingTradeDown` is set by `renderDist` in the same render pass), instead of only
  linking "→ Go to Cash". (`src/render/dist.js` `tradeSuggestionHTML`,
  `src/render/summary.js`)
- **Archetype 7 — Fast banknote entry.** Per-bill inputs get `enterkeyhint="next"`;
  Enter hops $100 → $50 → … → $1 within the pool card, blurring after the last row.
  (`src/render/pools.js`, `App.billKey` in `src/main.js`)
- **Archetype 5 — Envelope math peek.** The person modal's Base cell now shows the
  unrounded share (`$260.38 exact`) under the floored value. (`src/render/modals.js`,
  `css/person-modal.css`)
- **15-minute time grid.** `parseTime` now only accepts `.25` steps (`5.3` rejected,
  error message updated in `resolve.js`). This is the prerequisite that unblocks
  slider/scrub/stepper time UIs: every time sits on a finite snapped grid, so a drag
  handle's positions map 1:1 to valid stored values. (`src/time.js`,
  `tests/time.test.js`, noted in `CLAUDE.md`)

## Removed

- **Step wizard (Model 01, first sandbox).** Step strip, Back/Next nav, and
  workflow-ordered tabs were applied then reverted by request; tab bar is back to
  Summary · Staff · Cash with Summary as the fresh-session default.

## Candidates for later

- **Archetype 2 — swipe/quick actions on staff rows** (cycle role, toggle closer)
  without opening menus; closer toggle exists, role swap could join it in the person
  modal or as row swipe.
- **Archetype 1/3 — steppers** (±15 min) on the global close time in the defaults
  modal; the Close Time sidebar already covers scrubbing candidates.
- **Session ledger** (first sandbox Model 04): saved-shift springboard replacing the
  destructive "New Session"; `persist.js` serialize/migrations are ready to build on.
- **Pool carousel** (first sandbox Model 03) for multi-pool Cash sessions.

## Skip (poor fit)

- **Archetype 9 — voice stepper** (excluded by request).
- **Archetype 8 — weighted pool splits**: the unified-pool model splits by overlap
  hours, not weights.

## Unblocked by the 15-min grid

- **Archetype 6 — timeline scrub.** Previously skipped because free-decimal entry
  made slider positions lossy. With times snapped to `.25`, a per-person horizontal
  shift bar on a shared axis becomes viable: drag handles move in 15-min ticks,
  writing the same raw strings the text inputs produce (`'5.25'`), so text and slider
  entry stay interchangeable. Natural home: an optional "timeline" view of the staff
  list, or the person modal's In/Out row. Steppers (±.25) are the cheap first step;
  full drag tracks the second.

## Thumb-Zone Minimalist restructure (Archetype 3)

### ✅ Option B applied — incremental thumb-zone pass

- **Shift Actions sheet.** The header's three-button cluster + dropdown is now a
  single "⋯" opening a bottom sheet: Closer Bonus & Chump, Close Time Bills, Default
  Shift Times, Export/Import JSON, New Session — all in one reachable list
  (`#actionsSheet` in `index.html`, `.action-list` in `css/modals.css`). The old
  `session-menu` dropdown and its click-away listener are deleted.
- **Role dock.** The staff role toggle (Bartender/Server/Support) moved from the top
  of the Staff tab to a fixed dock riding the tab bar (`#roleDock`); visible only on
  Staff, hides with the keyboard, and the PiP HUD lifts above it
  (`body.tab-staff-on` rule in `css/tabs.css`).
- Date input stays in the header (touched once per session).

### Option A — future destination (keep buildable)

Summary as the always-visible base canvas; Staff and Cash become drag-up bottom
sheets with half/full detents, tab bar replaced by sheet handles. **Option B was
built as a stepping stone to this**: the Shift Actions sheet establishes the
"navigation lives in sheets" pattern, and the role dock proves fixed thumb-zone
strips above the tab bar. Remaining path: (1) Option C below as the bridge — the
PiP HUD becomes a drag-up handle peeking Summary; (2) move Staff/Cash panel content
into sheet bodies behind the same render targets (`#staffList`, `#pools-content`
keep their ids, so renderers don't change); (3) retire the tab bar last. Known
risks to solve before committing: sheets occluding the numbers being watched, and
iOS keyboard-inside-sheet handling.

- **Option C — promote the PiP HUD to a drag-up mini-sheet.** The HUD becomes a
  grabbable handle: drag up from any tab to peek Summary at half height, full drag =
  switch. Gives Option A's "always-reachable results" without the restructure; the
  natural next increment after B.
- **Tab roster alternative ("tabular restructure"):** two tabs instead of three —
  **Shift** (staff + pool windows on one timeline canvas, per the unblocked Archetype
  6) and **Payout** (summary + distribution + diagnostics). Cash entry opens as a
  bottom sheet from either. Worth prototyping only after B/C prove out.

## Globalize the design system

### ✅ Applied so far

1. **Tokens** (`variables.css`): spacing scale (`--sp-1..--sp-6`), type scale
   (`--fs-2xs..--fs-xl`), z-index ladder (`--z-hud` < `--z-bar` < `--z-sheet`);
   tab bar / role dock / PiP HUD / modal overlay migrated onto the ladder.
2. **Shared primitives** (`components.css`): `.warn-link` (replaces the inline-styled
   warn-box link buttons in summary.js and dist.js), `.qa-row`/`.qa-btn` quick-action
   launchers, `.pip-strip` inline live strip. Dead `.bill-chart-btn` CSS deleted.
3. **Quick-action launchers everywhere**: a 4-up row (Bill Chart · Close Time ·
   Remainder · Exchange) renders on both Summary layouts (`quickActionsHTML()` in
   summary.js) and is pinned at the bottom of the Staff and Cash tabs (static HTML).
   Exchange = `App.openExchanges()` → dist modal scrolled to the trade card. The
   actions sheet keeps its entries too.
4. **PiP everywhere**: `pipStripHTML(vm)` (exported from render/tabs.js, shared with
   the floating HUD) is embedded at the top of the dist modal, Close Time sidebar,
   Remainder modal, and Person modal — all four re-render on every state change while
   open, so editing inside them (times, bonuses, close-time candidates) live-updates
   Rate / Pool / Chump in the same view.

### Remaining

- ~16 inline `style="..."` occurrences left in renderers (mostly one-off color/width
  tweaks in summary.js/dist.js tables) → promote to classes.
- Consolidate the 4 badge families (`.closer-badge`, `.rem-closer-badge`,
  `.role-badge`, `.ds-role-badge`) onto one `.badge` primitive.
- Canonical `.btn` variants for the remaining look-alike buttons (`.add-btn`,
  `.ct-open-btn`, `.trade-apply-btn`, `.dp-add-party-btn`, `.rem-reset-btn`).
- Merge `summary.css` / `summary_day.css` behind shared card/table primitives.
- Document the token system in CLAUDE.md.

## Other (not in sandboxes)

- **Service worker** — manifest + icons exist but no SW; the PWA isn't actually
  offline-capable yet.
