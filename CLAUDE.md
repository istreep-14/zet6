# TipPool — Claude Code Guide

## What this app is

A mobile-first, zero-dependency single-page web app for calculating and distributing a cash tip pool among restaurant/bar staff. No server-side code, no build step, no npm install. ES modules served statically.

**Unified pool model (v4):** there is no day/night mode split. Tips are entered into one or more *pools*; each pool has its own time window, role inclusion (Bar / Srv / Sup chips), and cash entry. "Night shift" is just the default single pool with no window (whole shift). Support staff included in a pool are ordinary participants sharing by overlap hours — there is no separate tip-out formula.

---

## Running the app

```bash
npx serve .          # or
python3 -m http.server
# then open the served URL — ES modules require http, file:// won't work
```

PWA-ready: `manifest.json` + `icon-192.png` / `icon-512.png` enable "Add to Home Screen."

## Running tests

```bash
npm test                     # node --test "tests/*.test.js"
node tests/shares.test.js    # any single file runs standalone
```

Plain `node:assert` scripts imported as native ES modules (`"type": "module"` in package.json) — no framework, no vm hack.

---

## Architecture

One-way pipeline, pure compute, renderers read only the view model:

```
input event → App.* handler → store action mutates state
  → schedule (120ms debounce; structural changes immediate)
  → buildViewModel(state):
      resolveStaff → resolvePools → computeShares → bills → distribute
  → render(vm) per area → persist.save(state)
```

### Files (src/)

| File | Role |
|---|---|
| `store.js` | The single state object + actions (mutations) + subscribe |
| `ids.js` | String id generator (`s1`, `p1`) — ids never come from the DOM |
| `util.js` | `DENOMS`, `parseWholeNumber`, `poolValue`, `escapeHTML`, `fmtHrs` |
| `time.js` | `parseTime`, absolute-axis wrap (`toAbs`), `fmtTimeAbs`, `overlapHours` |
| `resolve.js` | `resolveStaff` / `resolvePools` — raw strings → abs times; closer rule |
| `shares.js` | `computeShares` — THE tip split (every view runs this same function) |
| `ideal.js` | `idealBills(total, targets)`, `mergedBillCounts(pools)` |
| `engine.js` | Bill distribution pipeline (ported from v3, pure) + trade helpers |
| `viewmodel.js` | `buildViewModel` — runs the whole pipeline, packages render data |
| `persist.js` | localStorage save/load, schema v4 + v1–v3 migration, export/import |
| `render/*.js` | `staff` `pools` `summary` `dist` `modals` `tabs` — DOM only |
| `main.js` | Bootstrap: load → subscribe → first render; exposes `window.App` |

### State shape (store.js)

```js
{
  meta: { date },
  staff: [{ id, name, role, in, out, closerOverride }],   // ONE array, role is a field
  defaults: { global: {in, out}, byRole: {bartender, server, support} },
  pools: [{ id, label, window: {start, end}, roles: {bartender, server},
            includeSupport, cash: { entryMode, billCounts, netTotal } }],
  overrides: { bonuses: { staffId: $ } },                  // manual remainder split (persisted)
  settings: { allRoles, multiPool },                        // simple/detailed UI toggles (persisted)
  ui: { activeTab, staffViewRole, selectedPool },
}
```

Raw input strings are stored as typed; `''` means "inherit a default." All parsing/resolution happens in `resolve.js` at compute time.

### Time model

Entry is decimal 12-hour (`5` = 5:00, `10.5` = 10:30, `2` = 2 AM/PM by context) on a 15-minute grid — `parseTime` only accepts `.25` steps (`5.3` is invalid), so scrub/stepper UIs can assume snapped positions. Everything resolves onto one absolute axis: `abs(t) = t >= anchorRaw ? t : t + 12`, where the anchor is the resolved global In (the shift "open"). A session spans < 12h. Display am/pm is a heuristic: anchors in [8, 12) read as morning opens.

### Resolution & closer rule (resolve.js)

Per person: `in = explicit || roleDefault || global.in`; `out = explicit || roleDefault || closeTime` (blank Out inherits the close time = resolved global Out). Closers: `closerOverride || out ≥ peak out across tipped staff` — ties share; support staff never auto-close. Pool windows: blank start = earliest resolved in, blank end = close time.

### Tip split (shares.js)

Per pool: participants = staff whose role is enabled (or support if `includeSupport`) with overlap > 0; `rate = total / Σhours`. Then once across all pools: `base = floor(Σ rawShares)`; remainder = Σ totals − Σ base; bonuses = manual overrides if any, else split among closers; leftover = chump. The Close Time sidebar, net-total ideal targets, and live calc are the same `computeShares` call with different inputs.

### Distribution engine (engine.js)

1. Preflight — cash covers payouts, enough small bills
2. Preferred path — proportional $100s/$50s, balanced sweep of lower denoms
3. DFS fallback — up to 100 paths, graded for evenness

On failure, `suggestBreaks` searches for the fewest "break one bill into smaller bills" swaps (any denomination, ≤3, iterative deepening) that make `distribute` succeed. It falls back to `previewSmallBillTrades` (small-bill heuristic) if nothing turns up. The UI only shows the "small bills needed" card when $1/$5/$10 minimums are actually short (`smallBillsShort` in render/dist.js).

`distribute(people, bills, leftover)` → `{ byPerson: {id→bills}, remainderBills, poolAfter, error }` — pure, no mutation. Per-bill pools merge into one drawer; any net-total pool ⇒ ideal bills derived from the actual payout targets.

---

## Persistence

- Auto-saves to localStorage key `tippool_v1` after every render (debounced with compute).
- Snapshot is `{ v: 4, saved, state }` — the state object directly.
- v1–v3 snapshots (old DOM-serialized shape) migrate on load: bartender/server/support lists → one staff array, night cash → one pool; day-pool/cut data is dropped.
- Validate-or-discard: malformed data never crashes the app.
- Export/import on the More tab produces a dated `.json` file (normalized to v4 on import).

---

## UI notes

- **Simple vs detailed** (`state.settings`, switches on the More tab; New session keeps them). Defaults are simple. `allRoles` off → no role seg, one flat staff list, inline In/Out edits the whole-shift open/close, new people are bartenders. `multiPool` off → no "+ Add pool" (can't be switched off while >1 pool exists). One pool → card is always open, titled "Tips", no window/label; plus roles off → no "Shared by" chips. Old snapshots derive settings from their data (`normalizeSettings` in store.js). Compute ignores settings.
- **Tabs** = Payout · Staff · Cash · Bills · More (`.panel` sections, `.tabbar`), swipe left/right on the content to move between them (ignored inside `.tbl-wrap`, while typing, or on vertical drags). Header is just title + date. A live HUD (`#pipHud`) floats over Staff/Cash with rate / pool / chump; tap → Payout. The Bills tab badge shows `!` when the bills can't pay everyone out.
- **Payout** = hero totals + 2-up tool row (Close time, Bonus) + warnings, then the person list (single pool) or a pool × person matrix (`.tbl`, multi-pool).
- **Staff** = sticky role segmented control, role default In/Out bar, one grid row per person (name · in · out · hrs · closer · ✕). Closer button: dashed = auto closer, filled = override. Enter walks across a row; Tab walks down columns.
- **Cash** = pool accordion (`.pool`). Open card: entry mode seg → net/bills, "Shared by" chips, support tip-out, window, label. Closed cards don't render a body.
- **Bills** = bill distribution table, small-bill needs, break/trade-up suggestions (`#dist-content`, rendered by render/dist.js).
- **More** = settings switches, tools (bonus, close-time, default times), export/import/new session (`.list-card` groups).
- **Sheets** = `.sheet-backdrop` + `.sheet` bottom sheets, toggled with `.open` by id (remainder, close time, defaults, person).
- Inline `onclick`/`oninput` handlers call `window.App.*` (defined in `main.js`) since module functions aren't global.
- Staff rows and pool cards re-render only on structural changes (add/remove/switch); keystrokes patch totals/hours in place so inputs never lose focus.

## CSS / design system

One stylesheet: `css/app.css` (tokens at the top). Sized for 375–440pt iPhones (iPhone Air = 420×912pt) with safe-area insets for the Dynamic Island / home indicator; a `max-width: 374px` block handles SE-class phones. System fonts (`--font` SF Pro, `--mono` SF Mono, tabular numerals) — no web-font dependency. Key tokens: `--bg #0b0b10`, `--accent #e94560` (errors/closers), `--gold #f5c842` (money), `--green #2ecc71`, role colors `--bar` / `--srv` / `--sup`, type scale 12/14/16/19/24px (hero 54), `--tap 48px`, max-width 480px. Inputs are 16px to stop iOS focus-zoom. Primitives: `.card`, `.btn`, `.seg`, `.chip`, `.badge--*`, `.msg`, `.field`, `.tbl`, `.stat-inline`.
