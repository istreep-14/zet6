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
| `roster.js` | Remembered staff names for quick-add (own localStorage key, survives New session) |
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

On failure, `planMakeChange` picks the fix that takes the fewest bills out of the drawer: `planExchange` (pay everyone from the drawer as far as it goes, then trade the unused bills in ONE exchange for exactly the small bills the remainders need — e.g. "Trade 3 × $50 for 5 × $20 + 3 × $10 + 2 × $5 + 10 × $1") vs `suggestBreaks` (fewest single "break one bill" swaps, ≤3, iterative deepening; wins ties). `previewSmallBillTrades` is the last resort, reported as one net trade. Plans rank by cash exchanged → $100s traded (at equal cash, trade $50s and keep the $100s) → bills handed over → $10s brought in → drawer size; the exchange places $100s/$50s with a DP that strands the least cash ($50s before a $100) so a $50 evens out an odd-tens payout instead of a $10.

Small-bill requirements (`getSmallBillRequirements`, used by preflight, the Bills card and the Close-time what-if) compute the $1+$5+$10 minimum with an exact DP over where the drawer's $100s/$50s can actually go — a $50 only saves a $10 if that payout has room for it after its $100s. $20s are assumed unlimited there; a $20 shortage shows as "larger bills don't divide evenly". The UI only shows the "small bills needed" card when $1/$5/$10 minimums are actually short (`smallBillsShort` in render/dist.js).

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
- **Payout** = hero totals + 2-up tool row (Close time, Bonus) + warnings, then the person list. With several pools, a Pools list (window, hours, $/hr, tips) comes first, and each person row adds a per-pool line; there is no matrix table. Person rows show real shift length (`shiftHours`), not hours summed across pools.
- **Staff** = sticky role segmented control, role default In/Out bar, a **Quick add** card (names remembered on this device in `tippool_roster` via `src/roster.js`, separate from the shift) that opens the `#rosterModal` sheet: a 3-column grid of large person cards (role-tinted initials), tap to multi-select or "Select all", then "Add N people" — each fills the next blank row of their role or adds one; Edit mode forgets names. Then one compact row per person: name · **In chip** · **Out chip** · hours. Each time chip slides vertically (up = later, 15 min per ~14px, `touch-action: none`) or taps open the `#timeModal` time sheet (big value per field that also slides, ▲/▼ steppers, a typed-entry input, and "Default · 5p" reset). Slides and steppers write the same raw strings typing would (`absToInRaw` / `absToOutRaw`), storing `''` when the result equals the default. Faded chip = default time; red Out chip = closer; red dot = forced closer. Swipe a row left for Closer / Reset / Delete (`App.rowAction`). The tab swipe ignores staff rows. Enter on a name jumps to the next name.
- **Cash** = pool accordion (`.pool`). Open card: entry mode seg → net total, or bill counts with −/+ steppers (`App.billStep`), "Shared by" chips, support tip-out, window, label. Closed cards don't render a body.
- **Bills** = an "Envelopes" table (one row per person, one column per bill size, chump row, Drawer totals row; `.tbl--bills` tightens under 400pt so it fits without sideways scroll), small-bill needs, and break/trade-up suggestions whose swap preview has one row per bill size (Bill · Now · Swap · After) (`#dist-content`, rendered by render/dist.js).
- **More** = settings switches, tools (bonus, close-time, default times), export/import/new session (`.list-card` groups).
- **Sheets** = `.sheet-backdrop` + `.sheet` bottom sheets, toggled with `.open` by id (remainder, close time, defaults, person, time, quick add). `.sheet-foot` holds a docked primary button.
- Inline `onclick`/`oninput` handlers call `window.App.*` (defined in `main.js`) since module functions aren't global.
- Staff rows and pool cards re-render only on structural changes (add/remove/switch); keystrokes patch totals/hours in place so inputs never lose focus.

## CSS / design system

One stylesheet: `css/app.css` (tokens at the top). iOS-style dark grouped look: black background, flat `--surface` cards with no outlines, hairline-separated grouped lists, a floating glass pill tab bar (`position: fixed`, `bottom: --bar-bottom` = max(safe-area inset, 12px)) over a `height: 100dvh` flex `<body>` — keep it that way: a `position: fixed` body makes the iOS home-screen app draw only a shortened viewport, cutting the bar off), a large per-tab title in the header (`#hdrTitle`, set in `switchTab`), and sentence-case labels. Gold is reserved for active and primary elements; amounts are white, rate is green, closers and errors are red, and role colors are `--bar` / `--srv` / `--sup`. System fonts only, with tabular numerals (no monospace) and `--rounded` for big numbers. Sized for 375–440pt iPhones (iPhone Air = 420×912pt) with safe-area insets; `max-width: 400px` and `374px` blocks tighten the staff grid for smaller phones. Inputs are ≥16px to stop iOS focus-zoom, and tap targets are about 44–48pt.
