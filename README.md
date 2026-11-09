# Tip Pool

A phone-first web app for splitting a cash tip pool at the end of a shift. Enter who worked and when, enter the cash, and it tells each person exactly which bills go in their envelope.

No server, no login, no build step. Add it to your iPhone home screen and it runs like an app; everything is saved on the device.

---

## Using it

The tab bar has three tabs, in the order you use them:

| Tab | What it's for |
|---|---|
| **Staff** | Who worked. Quick add saved people, set In/Out times, mark closers. With roles on, bartenders, servers and support each get their own section and default times. |
| **Tips** | The tips: type one net total, or count each bill size with −/+ steppers. |
| **Payout** | The answer: total pool and rate, then each person's shift, hours, pay **and the bills for their envelope**. If the drawer can't make exact change, a fix card shows the fewest swaps and **Apply** updates the cash count. **Show the working** explains the maths; Close time and Bonus tools sit below. |

Tap the bottom tabs (Staff · Tips · Payout) to move between steps. Inside a tab, swipe left or right to move between its sub-tabs — e.g. Payout's **Summary** (who gets what), **Bills** (envelopes and any bill swaps) and **Working** (how the split was worked out).

The menu button — or a swipe in from the left edge — opens the **sessions panel**: every saved shift (tap one to switch, Edit to rename or delete), **New session**, and app settings (servers & support, multiple pools, 24-hour time, import). The date in the header — or a swipe in from the right edge — opens **this shift's panel**: name, a calendar to set the date, default shift times, closer bonus, close-time what-if, export and delete.

### Staff

- **Quick add** opens a grid of everyone you've entered before. Tap people (or **Select all**), then **Add**. Names are remembered on this device, even after starting a new session. **Edit** removes saved names.
- Each person has an **In** chip and an **Out** chip:
  - **Slide a chip up or down** to change it 15 minutes at a time (up = later).
  - **Tap a chip** to open the time sheet: scroll the band (4:00 PM, 4:15 PM…), ▲/▼ steppers, type a time, or reset to the default.
- Times are typed as decimal 12-hour clock: `5` = 5:00, `10.5` = 10:30, `2` = 2:00 (am or pm worked out from the shift). Quarter hours only (`.25`, `.5`, `.75`).
- Faded times use the default for that role. A red Out time marks a closer.
- **Swipe a row left** for Closer, Reset and Delete.

### How the split works

1. Each person's share = their hours × (total tips ÷ total hours).
2. Shares round down to whole dollars.
3. The leftover dollars go to the closers (or however you set them in **Bonus**).
4. Anything that still can't be split evenly stays in the drawer as the "chump".

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
