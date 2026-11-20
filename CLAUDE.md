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
| `textout.js` | `summaryText(vm, title)` — the Summary as space-padded plain text for the clipboard (title, blank line, tips · hours · rate, the people table with a Total row, then the bills per person — a column per size used, chump, drawer totals — when they work out) |
| `persist.js` | localStorage save/load, schema v4 + v1–v3 migration, export/import |
| `ui/preact.js` | Re-exports Preact + htm (`html`, `render`, hooks) from the vendored file |
| `ui/pkit.js` | Component kit (Preact) — `Icon` `Card` `Label` `Button` `Seg` `Chip` `Stepper` `Field` `SwitchRow` `ListRow` `Badge` `Alert` `Empty` `Blocked` `Stat` `Money` `Denom` `LiveStrip` `SheetShell` + `cx` and shared class tokens (`INPUT`, `SEP`, `ROLE_TINT` / `ROLE_DOT` / `ROLE_TEXT` / `ROLE_PLURAL`) |
| `ui/icons.js` | Line icon paths, drawn by `<${Icon} name="clock" class="size-5" />` |
| `ui/toast.js` | `toast(text)` (a short message over the tab bar) and `copyText(text)` (clipboard with a fallback) |
| `ui/sheet.js` | Bottom sheets: mount all shells, `openSheet` / `closeSheet` / `isOpen`, close hooks |
| `ui/panels.js` | Side panels (left / right): open / close / toggle, open hooks, edge-drag gestures |
| `render/*.js` | `summary` `staff` `tips` `payout` `closetime` `sheets` `tabs` (bottom tabs) `drawer` (left panel) `shiftpanel` (right panel) — DOM only, built from the kit |
| `main.js` | Bootstrap: load → mount sheets → subscribe → first render; exposes `window.App` |

### State shape (store.js)

```js
{
  meta: { date },
  staff: [{ id, name, role, in, out, closerOverride }],   // ONE array, role is a field
  defaults: { global: {in, out}, byRole: {bartender, server, support} },
  pools: [{ id, label, window: {start, end}, roles: {bartender, server},
            includeSupport, cash: { entryMode: 'mixed', billCounts, netTotal, restMode, adjust } }],  // counted bills + rest ('rest') or total incl. counted ('total') + register over/short
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

On failure, `planMakeChange` picks the fix that takes the fewest bills out of the drawer: `planExchange` (pay everyone from the drawer as far as it goes, then trade the unused bills in ONE exchange for exactly the small bills the remainders need — e.g. "Trade 3 × $50 for 5 × $20 + 3 × $10 + 2 × $5 + 10 × $1") vs `suggestBreaks` (fewest single "break one bill" swaps, ≤3, iterative deepening; wins ties). `previewSmallBillTrades` is the last resort, reported as one net trade. Plans rank by cash exchanged → $100s traded (at equal cash, trade $50s and keep the $100s) → bills handed over → bills brought back → $10s brought back → drawer size; the exchange first consolidates what comes back (`consolidateGet`: two $5s → a $10, five $1s → a $5 while everyone is still paid exactly), so a swap asks for 1 × $10 rather than 2 × $5; the exchange places $100s/$50s with a DP that strands the least cash ($50s before a $100) so a $50 evens out an odd-tens payout instead of a $10.

Small-bill requirements (`getSmallBillRequirements`, used by preflight, the Bills card and the Close-time what-if) compute the $1+$5+$10 minimum with an exact DP over where the drawer's $100s/$50s can actually go — a $50 only saves a $10 if that payout has room for it after its $100s. $20s are assumed unlimited there; a $20 shortage shows as "larger bills don't divide evenly". The UI only shows the "small bills needed" card when $1/$5/$10 minimums are actually short (`smallBillsShort` in render/dist.js).

`distribute(people, bills, leftover)` → `{ byPerson: {id→bills}, remainderBills, poolAfter, error }` — pure, no mutation. The drawer comes from `drawerBills(pools, people, leftover)`: every pool's counted bills are kept as entered; the uncounted rest (`netTotal`) plus the register adjustment is filled with the bills the payouts need most (the $1 / $5 / $10s still short given where the counted $100s / $50s can go, then $20s) — `added` is that fill (Tips' "Best bills" card). A negative remainder (short more than the uncounted cash) comes off the counted bills, largest first; when that can't be exact, `note` asks for a recount.

---

## Persistence

- **Sessions** (`sessions.js`): every shift is its own session. The index `tippool_sessions` = `{ v, current, list: [{ id, name, date, created, saved, total, people }] }`; each session's snapshot lives at `tippool_s_<id>`. On first run the legacy single-session key `tippool_v1` becomes the first session (left in place, no longer written).
- Auto-saves the current session after every render (debounced with compute) and refreshes its index summary.
- Snapshot is `{ v: 4, saved, state }` — the state object directly.
- Switching sessions happens in place (no reload): flush the outgoing session, `store.replaceState`, invalidate staff/tips, re-render. `settings` are app preferences carried into whichever session opens (forced on if that session uses roles / several pools).
- Cash is one form (`entryMode: 'mixed'`): counted bills + the uncounted rest (`netTotal`) + a signed register `adjust` ("-50"). Older pools load through `normalizeCash` (persist.js): `perbill` keeps its counts and drops the unused net total, `nettotal` keeps the net total and drops the counts. `resolvePools` still honours an old mode if one slips through.
- v1–v3 snapshots (old DOM-serialized shape) migrate on load: bartender/server/support lists → one staff array, night cash → one pool; day-pool/cut data is dropped.
- Validate-or-discard: malformed data never crashes the app.
- Export (current session) / import (adds a new session and opens it) in the drawer; a dated `.json` file, normalized to v4 on import.

---

## UI notes

- **Writing UI:** every view is a Preact component written with htm's `html` tagged template (reads like JSX: `html\`<${Card} flush>…<//>\``), built from `ui/pkit.js` and styled with Tailwind classes. Each area is re-rendered with the latest view model on every app render (`render(html\`<${View} vm=${vm} />\`, root)`); Preact diffs, so input focus, scroll and `<details>` state survive — no signatures, patch passes or focused-input guards. Handlers are functions calling `window.App.*` (`onClick=${() => App.tab('tips')}`); local UI state uses hooks (`useState`). Colour values are CSS variables in `css/app.css` (`--bg`, `--surface`, `--accent` … light in `:root`, dark under `prefers-color-scheme` and `[data-theme=dark]`); `index.html`'s `@theme inline` block names them for Tailwind (`bg-surface`, `bg-surface-2`, `text-ink-3`, `text-accent`, `bg-bar/14`, `rounded-card` …). In hand-written CSS or `style=` use the raw variable (`var(--accent)`), not `--color-*`. Lay screens out with the pkit building blocks so they stay consistent: `<${Section} title aside footer>` (small uppercase caption above a group, footnote under it; `Label` is the same caption standalone), `<${Card} flush>` holding `<${Row} lead title sub trail onClick>` list rows, `<${Banner} tone=ok|error|warn title sub onClick>` for status (children = extra content, e.g. the fix steps), `<${Stats} items>` for 2–4 figures in one block split by hairlines. A visual change to a repeated piece = edit its pkit component once. Tailwind's browser build scans the live DOM, so dynamic class names work; `<html>` gets `.ready` (main.js, a `hidden` probe) once the utilities have compiled, which un-hides the page. Note htm/Preact render `${0}` as "0" — guard numbers with `n > 0 && …`.
- **Clock:** every displayed time goes through `fmtTimeAbs` (time.js): "h:mma/p" by default, "HH:MM" when `settings.clock24` is on. Entry is unchanged — decimal 12-hour.
- **Side panels** (`ui/panels.js`) — X-app style, one scrim, one open at a time. Open from a header button, a drag in from that screen edge (follows the finger; `EDGE` = 24px, page swipes ignore touches that start there), or a horizontal flick on the page (→ left panel, ← right panel); drag back / tap the scrim / Esc to close.
  - **Left = sessions + app settings** (render/drawer.js, header menu button): **New session** (primary) → **Sessions** list (date tile, name or "Today"/"Yesterday"/date with " · 2" for same-day duplicates, people count, total; current row accent-tinted with live numbers; tap to switch; Edit → rename / delete) → **Appearance** (Theme: Auto / Light / Dark → `settings.theme`; Display size) → App settings switches → More (Import a session, link to the shift panel).
  - **Right = this shift** (render/shiftpanel.js, header date pill): session name, **inline calendar** (month grid, Today, ‹ ›; dots on days with other saved sessions — replaces the native date input, which didn't open reliably), shift times (whole shift + per role when roles on, support tip-out %), Tools (Closer bonus & chump, Close-time what-if — opening one closes the panel), Export / Delete session. Re-rendered on each app render while open. `App.openDefaults()` (Staff section default-times button) opens it scrolled to the times.
  - Deleting the current session opens the next newest, or a fresh one.
- **Simple vs detailed** (`state.settings`, switches in the left panel; shared by every session). `allRoles` off → one "On shift" section on Staff, no "Shared by" chips with one pool, the shift panel shows only the whole-shift times; new people are bartenders. `multiPool` off → no "+ Add pool" (can't be switched off while >1 pool exists). Compute ignores settings.
- **Tabs** = Summary · Staff · Tips · Payout in the bottom bar — **tap only** (thumb). **No sub-tabs**: every tab is one page (`subsFor` returns `[]`, so the `.subtabs` bar renders empty and a horizontal flick on the page just opens a side panel). Staff stacks one table per role; Tips lists pools as cards that open in a sheet; Payout is bills then the working on one page; Summary opens a pool's own table from the Total table's pool header. Header = menu button (left panel) · small title (fades in once the page's big `.page-title` scrolls away, `html.scrolled` set in ui/sticky.js) · date pill ("Sat, Nov 8 ⌄", opens the right panel). Each tab starts with its big title. A live HUD (`#pipHud`) floats over Summary / Staff / Tips: one row of four figure cells split by hairlines — Rate · Pool · Chump · small bills ("1·1·16" over "$10 · $5 · $1", each count in its bill tint; `smallBillsNeeded` in tabs.js from `vm.req`, which places the drawer's $100s / $50s first so a $50 that evens out an odd-tens payout saves a $10 — what the drawer should hold, after a swap if one is needed). No error state for a short drawer (the Payout tab's `!` badge covers that); the red ring is only for a blocked shift; tap → Summary (from Summary → Payout). Badges: staff count, tips total, `!` on Payout when the bills can't pay everyone out. Old snapshots' tab names map via `normalizeTab` (bills/more → payout, cash → tips; unknown → summary).
- **Staff** (render/staff.js) = note line (count · close · closers, warnings) → **Quick add** card (accent + tile, the first few saved names not on shift) → saved-people picker sheet (`sheet-roster`: 3-column name cards grouped by role — people on shift show their start, "On · 4p" — multi-select, Select all / Clear, Edit → tap to forget; footer = a **Start** chip row (Default, then half-hours ±2h) and "Add N people · 4p" → `App.rosterAddSelected`, which adds them with that In (blank when it equals the role default) and keeps the sheet open while saved names are left, so a night like 2 at 4p, 2 at 5p, 1 at 6p is three quick adds) → one table card per role under a `Section` heading (with roles on, Everyone shows all three) or one "On shift" card. Columns **Name · In · Out · Hrs · Close** at `grid-cols-[3fr_2fr_2fr_1fr_1fr]` (`STAFF_ROW`), every cell its own control: name (20px, first names) → person editor; In / Out **`TimePill`** (wraps the shared `DragTime`: plain text, no fill at rest — a faint fill while pressed, accent while dragged; set times bright bold, defaults `text-ink-2`; the tap fires on click, not pointerup, so it can't land on the sheet it opens) — tap → quick time sheet (`sheet-time`), **drag sideways** → 15-min steps (18px each, right = later), previewed in accent and written on release (`data-drag`, so page swipes ignore it); Close circle → toggles a forced closer (solid red; auto closer = red-tinted fill). Then an accent **"+ Add bartender"** row (`App.addBlank(role)`: reuses a blank row of that role or adds one, opens the person editor with the name focused) and a "Defaults 5p – 2a ›" footer (shift panel at its times). Person editor sheet (`sheet-staff`): name, role seg, In and Out pickers (`pickerFor(vm, p, field)`: big value, ±15-min buttons, half-hour chips scrolled to the current or nearest value, "Use default"), hours + takes-home, Closer switch, Reset times, Remove. Writes are the same raw strings typing would store (`''` when equal to the default). Only named people are listed.
- **Tips** (render/tips.js) = one cash form, no modes: **Bills you counted** (all six sizes, −/+ steppers via `App.billStep`, Enter hops down and on into the rest) — count the ones you can see at a glance, say 5 × $100 and 3 × $50 — then one amount box (`netTotal`) with a **Rest / Total** switch (`cash.restMode`): *Rest* = the uncounted dollars, *Total* = all the cash including the counted bills ("$2,320, of which 4 × $100 and 3 × $50") — the rest is worked out and shown in the box; switching converts the typed number (`App.poolRestMode`). The best bills are picked for whatever wasn't counted and **Register over / short** (a Short / Over `Seg` + amount → `cash.adjust` "-50", because iOS number pads have no minus key). The card header shows the total with its parts ("$550 counted · $631 rest · $50 short") and the pre-adjustment total struck through. Then "Shared by" chips (roles on), support tip-out box; several pools add window, label, Remove. Under it, **Best bills for the $X not counted** (`vm.looseBills`). Several pools: a stacked tile per pool (name, window, role dots, any over / short, total, ›) — tap → `sheet-pool` with that pool's full editor card; "+ Add pool" adds one and opens its sheet. A register adjustment re-splits the tips: `vm.sharesBefore` is the split before it, and Summary shows Was · Now · ±. Payout's **Apply** writes the swapped drawer as counts and folds the rest and the adjustment into them.
- **Summary** (render/summary.js) = for **reading** the shift (setup lives on Staff / Tips). The live HUD floats over it (tap → Payout). Pool warnings → a **register banner** when the Tips tab has an over / short ("Register short $50 · Tips re-split on $1,131 (was $1,181)", tap → Tips) → **Payouts** list: a caption row lined up with the columns (# · session name or PAYOUTS · HRS · TIPS), then a `List` with one `PayRow` per person in **Staff-tab order** (`staffOrder`: state order, grouped bartender → server → support when roles are on), built like a List `Item` on `PAY_GRID` (`grid-cols-[2rem_minmax(0,1fr)_2.75rem_4.5rem]`, so Hrs and Tips line up): a numbered tile 1…n in the Item icon box (`size-8 rounded-lg bg-surface-2`; `ROLE_TINT` when several roles share the shift; a faint `ring-bad/45` marks a closer) · name (`t-body font-medium`) over "5:00 pm – 2:00 am" (`t-small text-ink-3`, `Clock full`; the Staff tab's `StaffTime` → `DragTime`, tap → quick time sheet, drag sideways → 15-min steps, the hit box pads up over the name) · Hrs (centred, medium, `text-ink/80`) · Tips (semibold; support in `text-sup`) — or, with a register adjustment, **Was · Now · ±** (`PAY_GRID_ADJ`, change in `text-bad` / `text-good`). Rows are `min-h-11 py-1.5`. The row tap opens the Person sheet. Last row **Total** (users icon tile): the shift's default open / close (`DefaultTime`: drag, or tap → shift panel), tipped hours (support excluded), paid out. Footnote = role key. → **Pools** list with several pools (window · hours · rate, total; tap → that pool's own table, `PoolTable` in `sheet-poolsum`, same Staff order) → Close time · Bonus · **Copy as text** (`App.copySummary` → `summaryText` on the clipboard + a toast; also in the shift panel). No avatars anywhere in the app. Blocked/pristine states mirror Payout's.
- **Two list / table designs only** (pkit.js):
  1. **List** — comfortable, multi-line items: `<${List}>` of `<${Item} lead|icon title sub trail value valueTone chevron onClick tone>` — one rounded `surface` group (`.lgroup` in app.css) with iOS-style hairlines between rows, inset past the lead / icon (`--inset`). Used for sessions, app settings (`SwitchRow` is an Item with a switch), shift-panel tools, Quick add, Tips pool tiles, Payout pools, Summary tools, the Bonus sheet (person rows with steppers, totals). `Row` / `ListRow` are thin aliases.
  2. **Table** — compact data: `<${Table} cols rows foot fixed scroll stickyFirst>` (zebra rows, sticky shrinking header, label first column, total row on `TOTAL_FILL`; `{ section }` rows for sub-headings, `hl` / `onHead` columns). Used for Envelopes, Close-time what-if, the swap preview and small-bills table. The Summary and Staff grids are custom (fitted columns, drag times) but use the same tokens (`T_HEAD`/`TABLE_HEAD`, `zebra`, `THEAD`, total fill).
  Don't add a third look — new lists use List/Item, new data grids use Table.
- **All tables** (Summary, Staff, Payout envelopes): **zebra rows** (`zebra(i)` / `ZEBRA` in pkit — a faint ink tint on odd rows, no hairlines between people) and a **sticky header**: the header row carries `THEAD` after a `<${Sentinel} />`; `ui/sticky.js` (`refreshSticky()`, called after every render, plus a scroll listener on `.content`) sets `--thead-top` per tab (the top of the page) and toggles `data-stuck`, which shrinks the header (`data-[stuck]:h-7`, extra header lines `group-data-[stuck]:hidden`). `Card flush` uses `overflow-clip` (not hidden) so sticky works inside it. The Summary Total table's header sits outside its sideways scroller (so it can stick) and mirrors its `scrollLeft`; `useFitColumns(…, { head })` fits both grids to the same columns.
- **Support in tables:** support staff are paid a tip-out off the top, so their hours are left out of every hours total (Shift, per pool = `pool.tippedHours`, overall $/h), their hours are dimmed and their pay is in the support colour (`text-sup`); pool headers show the support cut ("−42.00 sup") and role dots for who shares the pool; a person whose role isn't in a pool gets blank, unfilled cells there (a gap in the pool's band), while "—" means in the pool but not working its window. The role key notes "support is a tip-out, not counted in hours".
- **Payout** (render/payout.js) = one page: **Bills**: pool warnings → green "Exact change for everyone" (bill count, drawer $) or the **fix card** (reason, small-bills-needed table only when $1/$5/$10 are actually short, the fewest swaps, Bill · Now · Swap · After preview, **Apply** writes the counts into the single pool) → **Envelopes** table **Name · bill columns · Pay** (`table-fixed`; every bill size actually used splits the middle equally, tinted `.bill-col` heads without $, hairline dividers), chump row, Total row = drawer count per bill + grand total; columns come from the real envelopes, else the swap preview (note says so), else none → "Tidy the drawer" trade-up when it still pays out exactly. Then "How the split works" (single pool) mirroring `computeShares` step by step; **Pools** list instead with several pools. Tap a row → Person sheet. Order is `payoutOrder` (util.js).
- **Sheets** (`ui/sheet.js` shells via `SheetShell`; bodies from render/sheets.js, closetime.js, staff.js) = Person payout (takes home, base/bonus, envelope grid, shift inputs), Closer bonus & chump (per-person steppers), Close-time what-if (table of close times, tap a head to set it, pinch to widen), Staff person editor, Staff quick time. Backdrop tap or × closes. Opening a tool from a side panel closes the panel first. Sheets re-render with the app while open.

## CSS / design system

Tailwind utilities in the components do almost everything. `css/app.css` holds only what utilities don't express well, in `@layer components` so utilities always win:

- colour tokens (light / dark), Poppins `@font-face` (vendored in `vendor/fonts/`), the type scale (`.t-display` `.t-title` `.t-head` `.t-body` `.t-small` `.t-cap`), list groups (`.lgroup > .li`) and `.figures`,
- the page shell (header + `.icon-btn` / `.hdr-pill` / `.hdr-title`, `.page-title`, `.content` scroller, docked `.tabbar`, `.hud`, fill-screen),
- the side panels (`.side--left` / `.side--right` / `.side-scrim`; `html.panel-open` + `left-open` / `right-open`, `panel-dragging` + `drag-left/right` while a finger drags one) and the sub-tab header (`.subtabs`, `.subtab`),
- bottom sheets (`.sheet-backdrop` / `.sheet` slide-up, page-coloured with a grab bar; cards inside stay `surface`),
- the settings `.switch`, and bill tints: `[data-d="N"]` → `--dc`, used by `.denom` (banknote tag), `.billtag` (small pill) and `.bill-col` (bill-table heads).

- **Look:** the same design system as barlog (`~/Code/barlog`): iOS-style grouped screens, light by default and dark with the system (or forced from App settings → Theme). **Surfaces:** the page, sheets and side panels are `bg`; cards / list groups are `surface` (no borders, no shadows); controls inside them are `surface-2`; the picked segment is `raised`. Hairlines (`line`) only between list rows and under table headers. Frosted `--glass` only on the tab bar and sheet footers. Each tab opens with a big `t-title`, groups have small uppercase `t-cap` captions.
- **Colour roles — one job each:** `accent` = tappable / active (primary buttons, links, active tab icon, selected chips, a dragged time pill); `good` = rate / fine; `bad` = closers and errors; `warn` = needs a look. Amounts and totals are plain `ink`. Roles `bar` / `srv` / `sup` (`ROLE_TINT` / `ROLE_DOT` in pkit.js) for role dots and badges; `--pool-2…4` (plus accent) colour the Summary pool bands. Bill tints `d100`…`d1` are only for bill sizes. Every colour has a light and a dark value — add new ones in all three places in app.css and name them in index.html.
- **Times:** pkit's `Clock` renders "5:45p" — a slightly smaller (0.8em) lowercase a / p, same weight (no ":00"; 24-hour has none).
- **Money:** `fmtMoney` (`$1,037`) or the kit's `Money()` (small "$"); tab badges use `fmtMoneyShort`.
- **Type:** Poppins everywhere (400/500/600/700, vendored), tabular numerals. Prefer the `.t-*` scale; weights stop at 600 except the page titles. Inputs ≥16px so iOS doesn't zoom.
- **Display size:** every size is in `rem` (Tailwind's scale, and arbitrary values written as `text-[1.25rem]`, never `px`; app.css too, except hairlines, media queries and the 480px column), so one root font size scales the whole UI. App settings → Display size sets `settings.size` (`s` / `m` / `l` = 12 / 13.5 / 16px on `<html data-size>`, default `m`). Write new sizes in rem (px ÷ 16) or they won't scale.
- **Sizing:** built for 375–440pt iPhones; `max-[400px]:` / `max-[374px]:` variants tighten small phones. Tap targets ≈44–48pt.

### Page shell & tab bar (fragile — read before touching)

- `<body>` is a `height: 100dvh` flex column (header · `.content` scroller). The tab bar is docked full-width at the bottom (frosted `--glass`, hairline on top): `position: fixed; bottom: 0`, height `--dock` = `--tab-h` + safe-area inset (padded by the inset). `.content` pads its bottom by `--dock` plus room for the HUD so nothing hides behind them; rows scroll under the frosted bar.
- The status bar style stays `black-translucent` (the header pads by the safe-area inset; the fill-screen fix below depends on it). Check that the status-bar text reads in the light theme on a phone.
- **Don't make `<body>` `position: fixed`.** In the iOS home-screen app that ties the page to a shortened viewport and the bar gets cut off.
- **Home-screen fill (`main.js`):** iOS can report a viewport shorter than the screen (e.g. 844 of 912pt). When detected, `html.fill-screen` sizes `<html>` and `<body>` to the real screen height (`--app-h`), the tab bar / HUD / sheets / side panels switch to `position: absolute` inside that box, and the window is kept scrolled to 0. Add `?pwa` to the URL to force this in a desktop browser.
- **Zoom is locked:** viewport meta (`maximum-scale=1, user-scalable=no`), `html { touch-action: manipulation }`, and iOS `gesture*` events blocked in `main.js`. A zoomed page shifts the fixed bar.
- Verify layout changes on a real phone **from the home screen** (delete and re-add the icon to pick up new code) — desktop emulation doesn't reproduce the iOS viewport quirks.

---

## Keeping docs current

When a UI change lands, update the matching bullet in **UI notes** above (and the CSS section if it touches the shell). README.md is the user-facing overview; keep it in step with features, not implementation details.
