# TipPool — Claude Code Guide

## What this app is

A mobile-first, no-build single-page web app for calculating and distributing a cash tip pool among restaurant/bar staff. No server-side code, no build step, no npm install. ES modules served statically; styling is Tailwind v4's browser build, vendored at `vendor/tailwind-browser-4.3.3.js` (no CDN). Views are **Preact + htm** components (React API, no build), vendored at `vendor/preact-htm-3.1.1.js`.

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
| `roster.js` | Remembered staff names for the Staff tab's saved-name chips (own localStorage key, survives New session) |
| `sessions.js` | Saved sessions: index (`tippool_sessions`) + one snapshot per session (`tippool_s_<id>`); boot, list, switch, rename, delete |
| `persist.js` | localStorage save/load, schema v4 + v1–v3 migration, export/import |
| `ui/preact.js` | Re-exports Preact + htm (`html`, `render`, hooks) from the vendored file |
| `ui/pkit.js` | Component kit (Preact) — `Icon` `Card` `Label` `Button` `Seg` `Chip` `Stepper` `Field` `SwitchRow` `ListRow` `Avatar` `Badge` `Alert` `Empty` `Blocked` `Stat` `Money` `Denom` `LiveStrip` `SheetShell` + `cx` and shared class tokens (`INPUT`, `SEP`, `ROLE_TINT` / `ROLE_DOT` / `ROLE_TEXT` / `ROLE_PLURAL`) |
| `ui/icons.js` | Line icon paths, drawn by `<${Icon} name="clock" class="size-5" />` |
| `ui/sheet.js` | Bottom sheets: mount all shells, `openSheet` / `closeSheet` / `isOpen`, close hooks |
| `ui/panels.js` | Side panels (left / right): open / close / toggle, open hooks, edge-drag gestures |
| `render/*.js` | `summary` `staff` `tips` `payout` `closetime` `sheets` `tabs` (bottom tabs + sub-tabs) `drawer` (left panel) `shiftpanel` (right panel) — DOM only, built from the kit |
| `main.js` | Bootstrap: load → mount sheets → subscribe → first render; exposes `window.App` |

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

- **Sessions** (`sessions.js`): every shift is its own session. The index `tippool_sessions` = `{ v, current, list: [{ id, name, date, created, saved, total, people }] }`; each session's snapshot lives at `tippool_s_<id>`. On first run the legacy single-session key `tippool_v1` becomes the first session (left in place, no longer written).
- Auto-saves the current session after every render (debounced with compute) and refreshes its index summary.
- Snapshot is `{ v: 4, saved, state }` — the state object directly.
- Switching sessions happens in place (no reload): flush the outgoing session, `store.replaceState`, invalidate staff/tips, re-render. `settings` are app preferences carried into whichever session opens (forced on if that session uses roles / several pools).
- v1–v3 snapshots (old DOM-serialized shape) migrate on load: bartender/server/support lists → one staff array, night cash → one pool; day-pool/cut data is dropped.
- Validate-or-discard: malformed data never crashes the app.
- Export (current session) / import (adds a new session and opens it) in the drawer; a dated `.json` file, normalized to v4 on import.

---

## UI notes

- **Writing UI:** every view is a Preact component written with htm's `html` tagged template (reads like JSX: `html\`<${Card} flush>…<//>\``), built from `ui/pkit.js` and styled with Tailwind classes. Each area is re-rendered with the latest view model on every app render (`render(html\`<${View} vm=${vm} />\`, root)`); Preact diffs, so input focus, scroll and `<details>` state survive — no signatures, patch passes or focused-input guards. Handlers are functions calling `window.App.*` (`onClick=${() => App.tab('tips')}`); local UI state uses hooks (`useState`). Theme tokens live in the `@theme static` block in `index.html` (`bg-surface`, `bg-raised`, `text-ink-2`, `text-gold`, `bg-bar/20`, `rounded-card`, `font-rounded` …) and are also CSS variables (`--color-gold`). A visual change to a repeated piece = edit its pkit component once. Tailwind's browser build scans the live DOM, so dynamic class names work; `<html>` gets `.ready` (main.js) once the theme has compiled, which un-hides the page. Note htm/Preact render `${0}` as "0" — guard numbers with `n > 0 && …`.
- **Clock:** every displayed time goes through `fmtTimeAbs` (time.js): "h:mma/p" by default, "HH:MM" when `settings.clock24` is on. Entry is unchanged — decimal 12-hour.
- **Side panels** (`ui/panels.js`) — X-app style, one scrim, one open at a time. Open from a header button, a drag in from that screen edge (follows the finger; `EDGE` = 24px, page swipes ignore touches that start there), or a flick past the first (→ left) / last (→ right) sub-tab; drag back / tap the scrim / Esc to close.
  - **Left = sessions + app settings** (render/drawer.js, header menu button): **New session** (gold) → **Sessions** list (date tile, name or "Today"/"Yesterday"/date with " · 2" for same-day duplicates, people count, total; current row gold-tinted with live numbers; tap to switch; Edit → rename / delete) → App settings switches → Import a session, link to the shift panel.
  - **Right = this shift** (render/shiftpanel.js, header date pill): session name, **inline calendar** (month grid, Today, ‹ ›; dots on days with other saved sessions — replaces the native date input, which didn't open reliably), shift times (whole shift + per role when roles on, support tip-out %), Tools (Closer bonus & chump, Close-time what-if — opening one closes the panel), Export / Delete session. Re-rendered on each app render while open. `App.openDefaults()` (Staff section default-times button) opens it scrolled to the times.
  - Deleting the current session opens the next newest, or a fresh one.
- **Simple vs detailed** (`state.settings`, switches in the left panel; shared by every session). `allRoles` off → one "On shift" section on Staff and no Staff sub-tabs, no "Shared by" chips with one pool, the shift panel shows only the whole-shift times; new people are bartenders. `multiPool` off → no "+ Add pool" (can't be switched off while >1 pool exists). Compute ignores settings.
- **Tabs** = Summary · Staff · Tips · Payout in the bottom bar — **tap only** (thumb). Horizontal swipes on the page move between the tab's **sub-tabs** instead: a sticky X-style header under the title (`.subtabs`, gold underline, counts / alert dot) built by `renderSubtabs` from `subsFor(tab, state)` / `activeSub` (render/tabs.js). Staff (roles on) → Everyone · Bar · Servers · Support (`ui.sub.staff`); Tips → Net total · Count bills (one pool: that pool's entry mode) or one header per pool (several pools: `ui.selectedPool`); Payout → Bills · Working/Pools (`ui.sub.payout`); Summary has none. `App.sub(tab, v)` sets it and slides the content in (`.sub-in-left/right`). Swipes are ignored inside `.overflow-x-auto`, the sub-tab header, at the screen edges, while typing, or on vertical drags. Old snapshots' tab names map via `normalizeTab` (bills/more → payout, cash → tips; unknown → summary). Header = menu button (left panel) + title + date pill ("Sat, Nov 8 ⌄", opens the right panel). A live HUD (`#pipHud`) floats over Staff/Tips with rate / pool / chump; tap → Summary. Badges: staff count, tips total, `!` on Payout when the bills can't pay everyone out (and a red dot on the Bills sub-tab).
- **Staff** (render/staff.js, rebuilt) = note line (count · close · closers, warnings) → **Add card**: type a name + Enter / gold + (`App.addPerson(name, role)` fills a blank row of that role or adds one, keeps focus for the next name; remembers it in `tippool_roster`), role seg when roles on and the sub-tab is Everyone, then saved names not on shift as one-tap chips (filtered while typing, first 12 + "more", Edit → × forgets) → one card per role (roles on; the sub-tab narrows to one) or one "On shift" card: header with role dot, count and a default-times button (opens the shift panel at its times), then rows **avatar · name · "5:00p – 2:00a" · hours** (defaults faded, set times bright, closer's out red, red dot = forced closer). Only named people are listed. Tap a row → **person editor sheet** (`sheet-staff`): name, role seg, In and Out pickers (big value, ±15-min buttons, a row of half-hour chips ±3h around the default scrolled to the current value, "Use default" reset), hours + takes-home line, Closer switch, Reset times, Remove. Writes are the same raw strings typing would store (`''` when equal to the default). No swipe or slide gestures.
- **Tips** (render/tips.js) = one pool's card at a time. Single pool: "Tonight’s tips" + total, entry mode chosen by the sub-tab header (Net total / Count bills), bill rows with −/+ steppers (`App.billStep`, Enter hops down), "Shared by" chips (roles on), support tip-out box, and a "Suggested bills" card in net-total mode. Several pools: the sub-tabs are the pools; the card adds its own Net/Count seg, window, label and Remove; "+ Add pool" below. Keystrokes patch totals in place.
- **Summary** (render/summary.js) = the shift at a glance, no bills: gold-glow hero (`.summary-hero`: date · session name, big total, rate / hours / people tiles) → pool warnings → bills status row (green "Exact change for everyone" or red "Bills need a swap", both → Payout) → **Payouts** card, one roomy row per person (avatar in role tint · name · "5:00p – 2:00a · 9h" with the closer's out in red · pay at 28px · closer/bonus note) with a thin role-coloured bar showing the share vs the largest → chump + "Paid out" footer → Close time · Bonus tools. Tap a row → Person sheet. Blocked/pristine states mirror Payout's.
- **Payout** (render/payout.js) = the cash side, two sub-tabs. **Bills**: pool warnings → green "Exact change for everyone" (bill count, drawer $) or the **fix card** (reason, small-bills-needed table only when $1/$5/$10 are actually short, the fewest swaps, Bill · Now · Swap · After preview, **Apply** writes the counts into the single pool) → **Envelopes** table **Name · bill columns · Pay** (`table-fixed`; every bill size actually used splits the middle equally, tinted `.bill-col` heads without $, hairline dividers), chump row, Total row = drawer count per bill + grand total; columns come from the real envelopes, else the swap preview (note says so), else none → "Tidy the drawer" trade-up when it still pays out exactly. **Working**: "How the split works" (single pool) mirroring `computeShares` step by step; **Pools** list instead with several pools. Tap a row → Person sheet. Order is `payoutOrder` (util.js).
- **Sheets** (`ui/sheet.js` shells via `SheetShell`; bodies from render/sheets.js, closetime.js, staff.js) = Person payout (takes home, base/bonus, envelope grid, shift inputs), Closer bonus & chump (per-person steppers), Close-time what-if (table of close times, tap a head to set it, pinch to widen), Staff person editor. Backdrop tap or × closes. Opening a tool from a side panel closes the panel first. Sheets re-render with the app while open.

## CSS / design system

Tailwind utilities in the components do almost everything. `css/app.css` holds only what utilities don't express well, in `@layer components` so utilities always win:

- the page shell (header + `.hdr-menu`, `.content` scroller, floating `.tabbar`, `.hud`, fill-screen),
- the side panels (`.side--left` / `.side--right` / `.side-scrim`; `html.panel-open` + `left-open` / `right-open`, `panel-dragging` + `drag-left/right` while a finger drags one) and the sub-tab header (`.subtabs`, `.subtab`),
- bottom sheets (`.sheet-backdrop` / `.sheet` slide-up; cards inside a sheet step up to `--color-raised`),
- the settings `.switch`, and bill tints: `[data-d="N"]` → `--dc`, used by `.denom` (banknote tag), `.billtag` (small pill) and `.bill-col` (bill-table heads).

- **Look:** bold, high-contrast dark glass — pure-black `bg` with two faint fixed glows on `<html>` (gold top, blue bottom-right) so glass has something to frost; `surface` cards stay **opaque** (swipe rows and sticky table cells paint `bg-surface` to cover what's behind them) and get a luminous hairline edge + top highlight from `.rounded-card.bg-surface` in app.css; real frosted glass (`--glass` + `--glass-blur` + `--glass-edge`) only on the tab bar, HUD, menu button, date pill, side panels and sheets. Hairline `sep` dividers, small bold uppercase labels, an 800-weight per-tab title. Gold is used sparingly (primary button, active tab icon, totals); icon tiles are neutral `bg-white/8`.
- **Colour roles:** gold = active and primary; amounts white; rate green; closers and errors red; roles `bar` / `srv` / `sup` (`ROLE_TINT` / `ROLE_DOT` in kit.js). Bill tints `d100`…`d1` are only for bill sizes.
- **Money:** `fmtMoney` (`$1,037`) or the kit's `Money()` (small "$"); tab badges use `fmtMoneyShort`.
- **Type:** system fonts, tabular numerals, `font-rounded` for big numbers. Inputs ≥16px so iOS doesn't zoom.
- **Sizing:** built for 375–440pt iPhones; `max-[400px]:` / `max-[374px]:` variants tighten small phones. Tap targets ≈44–48pt.

### Page shell & tab bar (fragile — read before touching)

- `<body>` is a `height: 100dvh` flex column (header · `.content` scroller). The tab bar is a floating, near-opaque pill (`--glass`): `position: fixed`, `bottom: --bar-bottom` = max(safe-area inset, 12px). `.content` pads its bottom by `--dock` so nothing hides behind the bar or the HUD, and a `mask-image` fades rows out before they reach the bar (off while the keyboard is open).
- **Don't make `<body>` `position: fixed`.** In the iOS home-screen app that ties the page to a shortened viewport and the bar gets cut off.
- **Home-screen fill (`main.js`):** iOS can report a viewport shorter than the screen (e.g. 844 of 912pt). When detected, `html.fill-screen` sizes `<html>` and `<body>` to the real screen height (`--app-h`), the tab bar / HUD / sheets / side panels switch to `position: absolute` inside that box, and the window is kept scrolled to 0. Add `?pwa` to the URL to force this in a desktop browser.
- **Zoom is locked:** viewport meta (`maximum-scale=1, user-scalable=no`), `html { touch-action: manipulation }`, and iOS `gesture*` events blocked in `main.js`. A zoomed page shifts the fixed bar.
- Verify layout changes on a real phone **from the home screen** (delete and re-add the icon to pick up new code) — desktop emulation doesn't reproduce the iOS viewport quirks.

---

## Keeping docs current

When a UI change lands, update the matching bullet in **UI notes** above (and the CSS section if it touches the shell). README.md is the user-facing overview; keep it in step with features, not implementation details.
