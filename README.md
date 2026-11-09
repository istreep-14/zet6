# Tip Pool

A phone-first web app for splitting a cash tip pool at the end of a shift. Enter who worked and when, enter the cash, and it tells each person exactly which bills go in their envelope.

No server, no login, no build step. Add it to your iPhone home screen and it runs like an app; everything is saved on the device.

---

## Using it

The tab bar has five tabs:

| Tab | What it's for |
|---|---|
| **Payout** | The answer: total pool and rate, then each person's shift (5:00p → 2:00a), hours and pay (red dot = closer). Tap **How the split was worked out** to see the maths step by step. Close time and Bonus tools sit below. |
| **Staff** | Who worked. Quick add saved people, set In/Out times, mark closers. |
| **Cash** | The tips: type one net total, or count each bill size with −/+ steppers. |
| **Bills** | The envelopes: which bills each person takes (in the same order as Payout), plus fixes when the drawer can't make exact change. |
| **More** | Settings (incl. 24-hour time), default times, export/import, new session. |

Swipe left or right on the page to move between tabs.

### Staff

- **Quick add** opens a grid of everyone you've entered before. Tap people (or **Select all**), then **Add**. Names are remembered on this device, even after starting a new session. **Edit** removes saved names.
- Each person has an **In** chip and an **Out** chip:
  - **Slide a chip up or down** to change it 15 minutes at a time (up = later).
  - **Tap a chip** to open the time sheet: ▲/▼ steppers, type a time, or reset to the default.
- Times are typed as decimal 12-hour clock: `5` = 5:00, `10.5` = 10:30, `2` = 2:00 (am or pm worked out from the shift). Quarter hours only (`.25`, `.5`, `.75`).
- Faded times use the default for that role. A red Out time marks a closer.
- **Swipe a row left** for Closer, Reset and Delete.

### How the split works

1. Each person's share = their hours × (total tips ÷ total hours).
2. Shares round down to whole dollars.
3. The leftover dollars go to the closers (or however you set them in **Bonus**).
4. Anything that still can't be split evenly stays in the drawer as the "chump".

With **Multiple pools** turned on (More tab), tips can be split by time window — e.g. a lunch pool and a dinner pool, each shared only by the people working then.

### Bills

The app works out which physical bills each person gets, keeping $100s/$50s proportional and spreading small bills evenly. If the drawer can't make exact change, the Bills tab shows the fewest swaps that fix it (e.g. "Break 1 × $20 into 2 × $10"), and **Apply** updates the cash counts.

### Simple vs detailed

By default the app is in simple mode: one staff list and one tip pool. On the More tab you can turn on **Servers & support** (separate bartender / server / support lists with their own default times) and **Multiple pools**.

---

## Saving

- Everything auto-saves on the device (`localStorage`).
- **Export JSON** on the More tab downloads the shift as a dated `.json` file; **Import JSON** loads one back.
- **New session** clears the shift but keeps your settings and saved names.

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
