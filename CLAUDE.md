# TipPool — Claude Code Guide

## What this app is

A mobile-first, no-build single-page web app for calculating and distributing a cash tip pool among restaurant/bar staff. No server-side code, no build step, no npm install. ES modules served statically; styling is Tailwind v4's browser build, vendored at `vendor/tailwind-browser-4.3.3.js` (no CDN).

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
| `ui/html.js` | `html\`\`` tagged template (auto-escapes; arrays join; null/false render nothing), `raw`, `cx`, `js`, `mount` |
| `ui/kit.js` | Component kit — `Card` `Label` `Button` `Seg` `Chip` `Stepper` `Field` `SwitchRow` `ListRow` `Avatar` `Badge` `Alert` `Empty` `Stat` `Money` `Denom` `BillTags` `SheetShell` + shared class tokens |
| `ui/icons.js` | Line icons: `icon('clock', 'size-5')` |
| `ui/sheet.js` | Bottom sheets: mount all shells, `openSheet` / `closeSheet` / `isOpen`, close hooks |
| `render/*.js` | `staff` `tips` `payout` `closetime` `sheets` `tabs` — DOM only, built from the kit |
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

- Auto-saves to localStorage key `tippool_v1` after every render (debounced with compute).
- Snapshot is `{ v: 4, saved, state }` — the state object directly.
- v1–v3 snapshots (old DOM-serialized shape) migrate on load: bartender/server/support lists → one staff array, night cash → one pool; day-pool/cut data is dropped.
- Validate-or-discard: malformed data never crashes the app.
- Export/import in the Settings sheet produces a dated `.json` file (normalized to v4 on import).

---

## UI notes

- **Writing UI:** markup is `html\`\`` templates built from `ui/kit.js` components and styled with Tailwind classes. Theme tokens live in the `@theme static` block in `index.html` (`bg-surface`, `bg-raised`, `text-ink-2`, `text-gold`, `bg-bar/20`, `rounded-card`, `font-rounded` …) and are also CSS variables (`--color-gold`). A visual change to a repeated piece = edit its kit function once. Inline `onclick`/`oninput` strings call `window.App.*`. Tailwind's browser build scans the live DOM, so dynamic class names work; `<html>` gets `.ready` (main.js) once the theme has compiled, which un-hides the page.
- **Clock:** every displayed time goes through `fmtTimeAbs` (time.js): "h:mma/p" by default, "HH:MM" when `settings.clock24` is on. Entry is unchanged — decimal 12-hour.
- **Simple vs detailed** (`state.settings`, switches in the Settings sheet; New session keeps them). `allRoles` off → one "On shift" section on Staff, no "Shared by" chips with one pool, defaults sheet shows only the whole-shift times; new people are bartenders. `multiPool` off → no "+ Add pool" (can't be switched off while >1 pool exists). Compute ignores settings.
- **Tabs** = Staff · Tips · Payout (workflow order), swipe left/right on the content to move between them (ignored inside `.overflow-x-auto`, staff rows, while typing, or on vertical drags). Old snapshots' tab names map via `normalizeTab` (summary/bills/more → payout, cash → tips). Header = title + date pill ("Sat, Nov 8" over a hidden native date input that opens iOS's picker) + gear (Settings sheet). A live HUD (`#pipHud`) floats over Staff/Tips with rate / pool / chump; tap → Payout. Badges: staff count, tips total, `!` on Payout when the bills can't pay everyone out.
- **Staff** (render/staff.js) = note line (count · close · closers, warnings) → **Quick add** card (names remembered in `tippool_roster`, picker sheet with 3-column person cards, multi-select, Edit forgets) → one card per role (roles on) or one "On shift" card: header with role dot, count and a default-times chip (opens the Default times sheet), the rows, and a "+ Add …" row. Row = name · **In chip** · **Out chip** · hours. Chips slide vertically (up = later, 15 min per ~14px) or tap open the time sheet (big sliding values, 15-min band wheel, ▲/▼, typed entry, "Default · 5:00p" reset); writes are the same raw strings typing would store (`''` when equal to the default). Faded chip = default; red Out = closer; red dot = forced closer. Swipe a row left for Closer / Reset / Delete. Rows re-render only on structural change; values patch in place.
- **Tips** (render/tips.js) = one card per pool. Single pool: always open, "Tonight’s tips" + total, Net total / Count bills seg, bill rows with −/+ steppers (`App.billStep`, Enter hops down), "Shared by" chips (roles on), support tip-out box, and a "Suggested bills" card in net-total mode. Multi-pool: accordion cards add window + label + Remove. Keystrokes patch totals in place.
- **Payout** (render/payout.js) = Payout + envelopes in one place: tally (total pool; bar/server rate, hours, head count) → pool warnings → **fix card** when the drawer can't make exact change (reason, small-bills-needed table only when $1/$5/$10 are actually short, the fewest swaps, Bill · Now · Swap · After preview, **Apply** writes the counts into the single pool) → the table: one `subgrid` grid of **Name · Hrs · Pay**, each row = role-tinted initials, name + calendar-style shift ("5–11:45PM"), the envelope's bills as tinted `BillTags` ("$20×2"), and (multi-pool) a per-pool line; chump line with its bills; Total row with what comes out of the drawer → key line (bonus folded into pay, role colours) → **Show the working** (`details.ws`, single pool, open state kept) mirroring `computeShares` step by step → Pools list (multi-pool) → Close time · Bonus tools → "Tidy the drawer" trade-up suggestion when it still pays out exactly. Order is `payoutOrder` (util.js). Hrs is real shift length.
- **Sheets** (`ui/sheet.js` + render/sheets.js, closetime.js, staff.js) = Settings (switches, tools, export/import/new session), Default times, Person (takes home, base/bonus, envelope grid, shift inputs), Closer bonus & chump (per-person steppers), Close-time what-if (table of close times, tap a head to set it, pinch to widen), Time, Quick add. Opening a tool from Settings closes Settings first. Sheets re-render with the app while open; input-bearing sheets only refresh unfocused inputs.

## CSS / design system

Tailwind utilities in the components do almost everything. `css/app.css` holds only what utilities don't express well, in `@layer components` so utilities always win:

- the page shell (header, `.content` scroller, floating `.tabbar`, `.hud`, fill-screen),
- bottom sheets (`.sheet-backdrop` / `.sheet` slide-up; cards inside a sheet step up to `--color-raised`),
- staff-row gesture state toggled from JS (`.sr-main` swipe, `.tchip` `is-set` / `is-blank` / `is-bad` / `is-scrubbing`, `.staff-row.is-closer` / `is-forced`, time-sheet `.tcol` / `.tval`),
- the settings `.switch`, and bill tints: `[data-d="N"]` → `--dc`, used by `.denom` (banknote tag) and `.billtag` (small pill).

- **Look:** dark grouped UI — near-black `bg`, flat `surface` cards (`rounded-card`), hairline `sep` dividers, small uppercase section labels, a large per-tab title in the header.
- **Colour roles:** gold = active and primary; amounts white; rate green; closers and errors red; roles `bar` / `srv` / `sup` (`ROLE_TINT` / `ROLE_DOT` in kit.js). Bill tints `d100`…`d1` are only for bill sizes.
- **Money:** `fmtMoney` (`$1,037`) or the kit's `Money()` (small "$"); tab badges use `fmtMoneyShort`.
- **Type:** system fonts, tabular numerals, `font-rounded` for big numbers. Inputs ≥16px so iOS doesn't zoom.
- **Sizing:** built for 375–440pt iPhones; `max-[400px]:` / `max-[374px]:` variants tighten small phones. Tap targets ≈44–48pt.

### Page shell & tab bar (fragile — read before touching)

- `<body>` is a `height: 100dvh` flex column (header · `.content` scroller). The tab bar is a floating, near-opaque pill (`--glass`): `position: fixed`, `bottom: --bar-bottom` = max(safe-area inset, 12px). `.content` pads its bottom by `--dock` so nothing hides behind the bar or the HUD, and a `mask-image` fades rows out before they reach the bar (off while the keyboard is open).
- **Don't make `<body>` `position: fixed`.** In the iOS home-screen app that ties the page to a shortened viewport and the bar gets cut off.
- **Home-screen fill (`main.js`):** iOS can report a viewport shorter than the screen (e.g. 844 of 912pt). When detected, `html.fill-screen` sizes `<html>` and `<body>` to the real screen height (`--app-h`), the tab bar / HUD / sheets switch to `position: absolute` inside that box, and the window is kept scrolled to 0. Add `?pwa` to the URL to force this in a desktop browser.
- **Zoom is locked:** viewport meta (`maximum-scale=1, user-scalable=no`), `html { touch-action: manipulation }`, and iOS `gesture*` events blocked in `main.js`. A zoomed page shifts the fixed bar.
- Verify layout changes on a real phone **from the home screen** (delete and re-add the icon to pick up new code) — desktop emulation doesn't reproduce the iOS viewport quirks.

---

## Keeping docs current

When a UI change lands, update the matching bullet in **UI notes** above (and the CSS section if it touches the shell). README.md is the user-facing overview; keep it in step with features, not implementation details.
