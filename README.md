# Tip Pool

A phone-first web app for splitting a cash tip pool at the end of a shift. Enter who worked and when, enter the cash, and it tells each person exactly which bills go in their envelope.

No server, no login, no build step. Add it to your iPhone home screen and it runs like an app; everything is saved on the device.

---

## Using it

**Summary** is home — every session opens on it. Until the shift is complete it shows the three close-out steps (who worked → the tips → who gets what), each one tap away; Staff and Tips end with a **Next** button.

| Tab | What it's for |
|---|---|
| **Summary** | Who gets what: each person's hours and take-home, each on one line — name, In and Out times in lined-up columns (tap or drag to adjust), hours and tips (tap or drag a time to adjust); the total row's bar shows each pool's window. With several pools it opens on the **Pools** table — every person's hours and tips in each pool (Day / Mid / Party), their total hours and take-home, and a totals row. Switch between **Shift** (times), **Pools**, **Bills** (each person's envelope) and **Math** (hours × rate and the rounding). **Copy as text** puts a plain summary on the clipboard for Notes. |
| **Staff** | Who worked, as a spreadsheet. Type a name in the **Add name** row — saved names pop up as you type, tap one to fill it. Times go in on the built-in **keypad**: `5`, `530` (5:30), `1045`, `5:3`; tap **a / p** for any time of day (a 7am start, a 9pm in). **Next** (or Tab, or the iPhone keyboard's arrows) moves along the row — Name → In → Out → next name — **‹** goes back, **↓** down the column, **Default** goes back to the default time. Drag a time sideways to nudge it 15 minutes. Tap **Hrs** for the rest (role, closer, remove); tap the circle to make someone a closer. **Quick add** picks several saved names with a start time. |
| **Tips** | The shift type and the cash. **Night shift** is one pool. **Day shift** is two: **Day** (bar + servers, from open until the servers are out) and **Mid** (bar only, from then until the bar is out) — the hand-over follows when the servers actually leave. **+ Party** adds a private party's tips: set its window, and they're shared by bar and servers by the hours they worked inside it (support gets a tip-out). For each pool, type the amount, or turn on **Count bills** for the bills you can see at a glance; **Over / short** re-splits if the register is off. |
| **Payout** | The bills: each person's envelope, bill by bill. If the drawer can't make exact change, a fix card shows the fewest swaps and **Apply** updates the cash count. **How the split works** explains the maths. |

The floating bar shows rate, pool, chump and the fewest $10 / $5 / $1s you need; tap it to move on. Swipe the page sideways to step through the tabs; swiping right on Summary opens the sessions panel, swiping left on Payout opens this shift's panel.

The menu button — or a swipe in from the left edge — opens the **sessions panel**: every saved shift (tap one to switch, Edit to rename or delete), **New session**, and app settings (theme Auto / Light / Dark, display size Small / Medium / Large, servers & support, multiple pools, 24-hour time, import). The date in the header — or a swipe in from the right edge — opens **this shift's panel**: name, shift type (Night / Day), a calendar to set the date, default shift times (keypad or drag; remembered separately for day and night shifts, and a new session starts from them), and in app settings **Morning starts at** — a bare `7` reads as 7am if mornings start at 7 or earlier, else 7pm (a / p always overrides), closer bonus, close-time what-if, export and delete.

### Staff

- **Quick add** lists saved names — pick several, choose their start time, **Add**. Names are remembered on this device, even after starting a new session. **Edit** removes saved names.
- **Tap a person** to edit them: their In and Out times (±15 minutes, or tap a half-hour time; **Use default** resets), make them a **closer**, or **remove** them.
- Default times are typed as decimal 12-hour clock in this shift's panel: `5` = 5:00, `10.5` = 10:30, `2` = 2:00 (am or pm worked out from the shift). Quarter hours only (`.25`, `.5`, `.75`).
- Faded times use the default for that role. A red Out time marks a closer.

### How the split works

1. Each person's share = their hours × (total tips ÷ total hours).
2. Shares round down to whole dollars.
3. The leftover dollars go to the closers (or however you set them in **Bonus**).
4. Anything that still can't be split evenly stays in the drawer as the "chump".

With **Support** sharing a pool, support staff get a tip-out first (10% of the pool by default, or a set $/hour, for the hours they worked); everyone else splits the rest by hours.

With **Multiple pools** turned on (sessions panel), tips can be split by time window — e.g. a lunch pool and a dinner pool, each shared only by the people working then.

### Bills

The app works out which physical bills each person gets, keeping $100s/$50s proportional and spreading small bills evenly. If the drawer can't make exact change, the Payout tab shows the fewest swaps that fix it (e.g. "Break 1 × $20 into 2 × $10"), and **Apply** updates the cash counts.

### Simple vs detailed

By default the app is in simple mode: one staff list and one tip pool. In the sessions panel you can turn on **Servers & support** (separate bartender / server / support lists with their own default times) and **Multiple pools**.

---

## Saving

- Everything auto-saves on the device (`localStorage`).
- Every shift is saved as its own **session**; **New session** starts a fresh one and keeps the old ones in the sessions panel. Settings and saved names are shared by all sessions.
- **Export JSON** in this shift's panel downloads the session as a dated `.json` file; **Import** in the sessions panel adds a file back as a new session.

---

## Running it locally

ES modules need to be served over http (opening `index.html` as a file won't work):

```bash
npx serve .
# or
python3 -m http.server
```

Then open the URL it prints. Add `?pwa` to the URL to preview the home-screen layout in a desktop browser.

## Tests

```bash
npm test                    # runs every tests/*.test.js
node tests/shares.test.js   # or one file on its own
```

Plain Node `assert` scripts — no framework, nothing to install.

---

## For developers

`CLAUDE.md` is the technical guide: architecture, the state shape, the time model, the split and bill-distribution algorithms, and notes on the iOS home-screen layout. Code lives in `src/` (pure logic modules plus `src/render/` for the DOM) and one stylesheet, `css/app.css`.
